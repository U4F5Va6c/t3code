import {
  IssueTrackerKind,
  TrimmedNonEmptyString,
  type IssueActor,
  type IssueCapabilities,
  type IssueState,
} from "@t3tools/contracts";
import {
  IssueTrackerError,
  type StandaloneIssueTrackerApi,
  type TrackerIssueSummary,
} from "@t3tools/source-control-core/server/IssueTracker";
import * as IssueTrackerHost from "@t3tools/source-control-core/server/IssueTrackerHost";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import * as CodeupApi from "./CodeupApi.ts";
import { Viewer } from "./codeupJson.ts";

const KIND = IssueTrackerKind.make("projex");
const HOST = "devops.aliyun.com";
const PAGE_SIZE = 100;
const CATEGORIES = ["Req", "Bug", "Task"] as const;
const Id = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z0-9_-]+$/i));
const isId = Schema.is(Id);
const Named = Schema.Struct({ id: Id, name: TrimmedNonEmptyString });
const Text = Schema.optional(Schema.NullOr(Schema.String));
const Timestamp = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 8.64e15 }));
const Person = Schema.Struct({ id: Id, name: Text });
const WorkItem = Schema.Struct({
  id: Id,
  serialNumber: Id,
  subject: TrimmedNonEmptyString,
  categoryId: Schema.Literals(CATEGORIES),
  space: Schema.Struct({ id: Id }),
  creator: Schema.NullOr(Person),
  assignedTo: Schema.NullOr(Person),
  status: Schema.Struct({ name: TrimmedNonEmptyString, displayName: Text }),
  statusStageId: Schema.optional(Schema.NullOr(Schema.String)),
  gmtCreate: Timestamp,
  gmtModified: Timestamp,
  updateStatusAt: Schema.optional(Schema.NullOr(Timestamp)),
  labels: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.Struct({ name: TrimmedNonEmptyString, color: Text }))),
  ),
  description: Text,
});
const WorkItems = Schema.Array(WorkItem);
const Names = Schema.Array(Named);
const Comments = Schema.Array(
  Schema.Struct({
    id: Id,
    user: Schema.NullOr(Person),
    content: Schema.String,
    gmtCreate: Timestamp,
  }),
);
const encodeConditions = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const capabilities = {
  create: false,
  edit: false,
  comment: false,
  labels: false,
  assignees: false,
  reactions: false,
  templates: false,
  linkedPullRequests: false,
  events: false,
  search: true,
} satisfies IssueCapabilities;

function parseIssueUrl(url: URL) {
  if (url.protocol !== "https:" || url.host !== HOST || url.username || url.password) return null;
  const match = /^\/projex\/(?:req|bug|task)\/([a-z0-9_-]+)\/?$/i.exec(url.pathname);
  return match?.[1] === undefined ? null : { host: HOST, scope: null, key: match[1] };
}

function failure(operation: string, reason: IssueTrackerError["reason"], detail: string) {
  return new IssueTrackerError({ tracker: KIND, operation, reason, detail });
}

function scopeParts(value: string, operation: string) {
  const [organizationId, spaceId, extra] = value.split("/");
  return extra === undefined && isId(organizationId) && isId(spaceId)
    ? Effect.succeed({ organizationId, spaceId })
    : Effect.fail(failure(operation, "not-found", "This ProjeX project scope is invalid."));
}

function actor(person: typeof Person.Type | null): IssueActor | null {
  return person === null
    ? null
    : { login: person.id, name: person.name?.trim() || null, avatarUrl: null };
}

function state(item: typeof WorkItem.Type): IssueState {
  const name = item.status.displayName?.trim() || item.status.name;
  switch (item.statusStageId) {
    case "4":
      return { name, category: "closed", closeReason: "completed" };
    case "5":
      return { name, category: "closed", closeReason: "canceled" };
    default:
      return { name, category: "open" };
  }
}

const iso = (value: number) => DateTime.formatIso(DateTime.makeUnsafe(value));

function summary(item: typeof WorkItem.Type): TrackerIssueSummary {
  const status = state(item);
  const assignee = actor(item.assignedTo);
  return {
    key: item.serialNumber,
    displayKey: item.serialNumber,
    title: item.subject,
    url: `https://${HOST}/projex/${item.categoryId.toLowerCase()}/${item.serialNumber}`,
    author: actor(item.creator),
    state: status,
    createdAt: iso(item.gmtCreate),
    updatedAt: iso(item.gmtModified),
    closedAt: status.category === "closed" && item.updateStatusAt ? iso(item.updateStatusAt) : null,
    assignees: assignee === null ? [] : [assignee],
    labels: (item.labels ?? []).map(({ name, color }) => ({ name, color: color?.trim() || null })),
    commentCount: 0,
  };
}

const makeTracker = Effect.gen(function* () {
  const api = yield* CodeupApi.CodeupApi;
  const host = yield* IssueTrackerHost.IssueTrackerHost;
  const credential = host.credentials
    .get(KIND)
    .pipe(
      Effect.flatMap((token) =>
        Option.isSome(token)
          ? Effect.succeed(Redacted.make(token.value))
          : Effect.fail(
              failure("readCredential", "unauthenticated", "Connect ProjeX in Settings."),
            ),
      ),
    );

  const read = <S extends Schema.ConstraintDecoder<unknown, never>>(
    input: CodeupApi.CodeupRequest,
    schema: S,
    token: Redacted.Redacted<string>,
  ) =>
    api.request(input, token).pipe(
      Effect.mapError((error) =>
        failure(
          input.operation,
          error.reason === "unauthenticated" ||
            error.reason === "not-found" ||
            error.reason === "rate-limited"
            ? error.reason
            : "failed",
          error.reason === "forbidden"
            ? "The token cannot access this ProjeX resource."
            : error.message,
        ),
      ),
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.catchTags({
        SchemaError: () =>
          Effect.fail(failure(input.operation, "failed", "ProjeX returned an invalid response.")),
      }),
    );

  const scopesInOrganization = Effect.fn("ProjexIssueTracker.scopesInOrganization")(function* (
    organization: typeof Named.Type,
    token: Redacted.Redacted<string>,
  ) {
    const scopes = [];
    for (let page = 1; ; page++) {
      const projects = yield* read(
        {
          operation: "ProjexProjects",
          organizationId: organization.id,
          body: { page, perPage: PAGE_SIZE },
        },
        Names,
        token,
      );
      for (const project of projects) {
        scopes.push({
          key: `${organization.id}/${project.id}`,
          name: `${organization.name} / ${project.name}`,
        });
      }
      if (projects.length < PAGE_SIZE) return scopes;
    }
  });

  return {
    kind: KIND,
    capabilities,
    standalone: {
      tracker: KIND,
      displayName: "ProjeX",
      host: HOST,
      scopeNoun: "project",
      credential: { label: "Yunxiao personal access token", helpUrl: null },
    },
    parseIssueUrl,
    probeCredential: Effect.fn("ProjexIssueTracker.probeCredential")(function* (value: string) {
      const token = Redacted.make(value);
      const [viewer, organizations] = yield* Effect.all(
        [
          read({ operation: "GetUserByToken" }, Viewer, token),
          read({ operation: "ListOrganizations" }, Names, token),
        ],
        { concurrency: 2 },
      );
      const scopes = yield* Effect.forEach(
        organizations,
        (org) => scopesInOrganization(org, token),
        { concurrency: 4 },
      );
      return { account: viewer.name?.trim() || viewer.id, scopes: scopes.flat() };
    }),
    getViewer: Effect.fn("ProjexIssueTracker.getViewer")(function* () {
      return (yield* read({ operation: "GetUserByToken" }, Viewer, yield* credential)).id;
    }),
    listIssues: Effect.fn("ProjexIssueTracker.listIssues")(function* (input) {
      const { organizationId, spaceId } = yield* scopeParts(input.scope, "listIssues");
      if (input.involvement === "mentioned") return { items: [], nextCursor: null };
      const perPage = input.limit;
      const page = input.cursor === undefined ? 1 : Number(input.cursor);
      if (!Number.isSafeInteger(page) || page < 1 || page * perPage > 10_000) {
        return yield* failure("listIssues", "failed", "The ProjeX list cursor is invalid.");
      }
      const conditions = [];
      if (input.query?.trim()) {
        conditions.push({
          fieldIdentifier: "subject",
          operator: "CONTAINS",
          value: [input.query.trim()],
          toValue: null,
          className: "string",
          format: "input",
        });
      }
      if (input.involvement !== "all") {
        conditions.push({
          fieldIdentifier: input.involvement === "assigned" ? "assignedTo" : "creator",
          operator: "CONTAINS",
          value: [input.viewer],
          toValue: null,
          className: "user",
          format: "list",
        });
      }
      const items = yield* read(
        {
          operation: "ProjexSearch",
          organizationId,
          body: {
            category: CATEGORIES.join(","),
            spaceId,
            page,
            perPage,
            orderBy: input.sort === "created" ? "gmtCreate" : "gmtModified",
            ...(conditions.length > 0
              ? { conditions: encodeConditions({ conditionGroups: [conditions] }) }
              : {}),
          },
        },
        WorkItems,
        yield* credential,
      );
      return {
        items: items
          .filter(
            (item) =>
              item.space.id === spaceId &&
              (input.state === "all" || state(item).category === input.state) &&
              (input.assignee === undefined || item.assignedTo?.id === input.assignee) &&
              (input.labels ?? []).every((label) =>
                item.labels?.some((candidate) => candidate.name === label),
              ),
          )
          .map(summary),
        nextCursor:
          items.length < perPage || (page + 1) * perPage > 10_000 ? null : String(page + 1),
      };
    }),
    getIssue: Effect.fn("ProjexIssueTracker.getIssue")(function* ({ scope, key }) {
      const { organizationId, spaceId } = yield* scopeParts(scope, "getIssue");
      if (!isId(key))
        return yield* failure("getIssue", "not-found", "Invalid ProjeX work item key.");
      const token = yield* credential;
      const item = yield* read(
        { operation: "ProjexGet", organizationId, params: { id: key } },
        WorkItem,
        token,
      );
      if (
        item.space.id !== spaceId ||
        (item.id !== key && item.serialNumber.toLowerCase() !== key.toLowerCase())
      ) {
        return yield* failure(
          "getIssue",
          "not-found",
          "This work item is outside the bound ProjeX project.",
        );
      }
      const comments = yield* read(
        { operation: "ProjexComments", organizationId, params: { id: item.id } },
        Comments,
        token,
      );
      return {
        ...summary(item),
        body: item.description ?? "",
        viewer: null,
        viewerPermissions: {
          setState: false,
          comment: false,
          edit: false,
          labels: false,
          assignees: false,
        },
        states: [],
        comments: comments.map((comment) => ({
          id: comment.id,
          author: actor(comment.user),
          body: comment.content,
          createdAt: iso(comment.gmtCreate),
          url: null,
        })),
        commentCount: comments.length,
        commentsCursor: null,
        events: [],
        linkedPullRequests: [],
      };
    }),
    getComments: () => Effect.succeed({ comments: [], nextCursor: null }),
  } satisfies StandaloneIssueTrackerApi;
});

export const make = makeTracker.pipe(Effect.provide(CodeupApi.layer));
