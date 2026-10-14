import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Crypto from "effect/Crypto";
import {
  WORK_ITEM_OPERATIONS,
  WorkItemError,
  TrimmedNonEmptyString,
  type WorkItemRef,
  type WorkItemCreateInput,
  type WorkItemMetadata,
  type WorkItemRelationType,
  type WorkItemValues,
} from "@t3tools/contracts";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as Projex from "@t3tools/source-control-codeup/server/ProjexApi";
import { withOrganizationCredential } from "@t3tools/source-control-codeup/server/CodeupApi";
import * as Receipts from "../persistence/WorkItemCreationReceiptRepository.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";

type Operations = typeof WORK_ITEM_OPERATIONS;
type Input<K extends keyof Operations> = Operations[K]["input"]["Type"];
type Output<K extends keyof Operations> = Operations[K]["output"]["Type"];
type Methods = {
  readonly [K in keyof Operations]: (input: Input<K>) => Effect.Effect<Output<K>, WorkItemError>;
};
export class WorkItemsService extends Context.Service<WorkItemsService, Methods>()(
  "t3/workItems/WorkItemsService",
) {}
const reverse = {
  PARENT: "SUB",
  SUB: "PARENT",
  DEPEND_ON: "DEPENDED_BY",
  DEPENDED_BY: "DEPEND_ON",
} as const;
const relations = Object.keys(reverse) as WorkItemRelationType[];
const fail = (reason: WorkItemError["reason"]) => new WorkItemError({ reason });
const isWorkItemError = Schema.is(WorkItemError);
const decodeCreated = Schema.decodeUnknownSync(Schema.Struct({ id: TrimmedNonEmptyString }));
const decodeItems = Schema.decodeUnknownSync(Schema.Array(Schema.Unknown));
const parse = <A>(f: () => A) =>
  Effect.try({
    try: f,
    catch: (cause) =>
      isWorkItemError(cause) ? cause : new WorkItemError({ reason: "unavailable", cause }),
  });
const canonical = (v: WorkItemValues) =>
  JSON.stringify(Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))));
const same = (a: unknown, b: unknown) =>
  JSON.stringify(Array.isArray(a) && a.length === 1 ? a[0] : a) ===
  JSON.stringify(Array.isArray(b) && b.length === 1 ? b[0] : b);
const make = Effect.gen(function* () {
  const host = yield* SourceControlHost.SourceControlHost;
  const api = yield* Projex.ProjexApi,
    receipts = yield* Receipts.WorkItemCreationReceiptRepository;
  const environmentId = yield* (yield* ServerEnvironment.ServerEnvironment).getEnvironmentId;
  const crypto = yield* Crypto.Crypto;
  // One service-owned queue covers relation graphs as well as individual item updates.
  const queue = yield* Semaphore.make(1);
  const req = api.request;
  const rawItem = (r: WorkItemRef) =>
    req({ organizationId: r.organizationId, operation: "ProjexGet", params: { id: r.id } }).pipe(
      Effect.flatMap((v) => parse(() => Projex.parseWorkItem(v))),
      Effect.flatMap((item) =>
        item.spaceId === r.spaceId ? Effect.succeed(item) : Effect.fail(fail("invalid-input")),
      ),
    );
  const metadata = (r: Input<"metadata">) =>
    Effect.gen(function* () {
      const types = yield* req({
        organizationId: r.organizationId,
        operation: "ProjexTypes",
        params: { id: r.spaceId },
        query: { category: r.category },
      }).pipe(Effect.flatMap((v) => parse(() => Projex.parseTypes(v))));
      const members = yield* req({
        organizationId: r.organizationId,
        operation: "ProjexMembers",
        params: { id: r.spaceId },
      }).pipe(Effect.flatMap((v) => parse(() => Projex.parseMembers(v))));
      if (!r.typeId) return { types, members, fields: [], statuses: [], relationTypes: [] };
      if (!types.some((t) => t.id === r.typeId)) return yield* fail("invalid-input");
      const params = { id: r.typeId, projectId: r.spaceId };
      const fields = yield* req({
        organizationId: r.organizationId,
        operation: "ProjexFields",
        params,
      }).pipe(Effect.flatMap((v) => parse(() => Projex.parseFields(v))));
      const statuses = yield* req({
        organizationId: r.organizationId,
        operation: "ProjexWorkflow",
        params,
      }).pipe(Effect.flatMap((v) => parse(() => Projex.parseStatuses(v))));
      const relationTypes = yield* Effect.forEach(relations, (relationType) =>
        req({
          organizationId: r.organizationId,
          operation: "ProjexRelationTypes",
          params: { id: r.typeId! },
          query: { relationType },
        }).pipe(
          Effect.flatMap((v) =>
            parse(() => ({ relationType, types: Projex.parseRelationTypes(v) })),
          ),
        ),
      );
      return { types, members, fields, statuses, relationTypes } satisfies WorkItemMetadata;
    });
  const edges = (r: WorkItemRef, relationType: WorkItemRelationType) =>
    req({
      organizationId: r.organizationId,
      operation: "ProjexRelations",
      params: { id: r.id },
      query: { relationType },
      requireUnpaginated: true,
    }).pipe(Effect.flatMap((v) => parse(() => Projex.parseRelationIds(v))));
  const related = (r: WorkItemRef, relationType: WorkItemRelationType) =>
    edges(r, relationType).pipe(
      Effect.flatMap((ids) =>
        Effect.forEach(ids, (edge) =>
          rawItem({ ...r, id: edge.targetId }).pipe(
            Effect.flatMap((target) =>
              req({
                organizationId: r.organizationId,
                operation: "ProjexItemWorkflow",
                params: { id: target.id },
              }).pipe(
                Effect.flatMap((v) =>
                  parse(() => ({
                    id: edge.id,
                    target,
                    relationType,
                    statuses: Projex.parseStatuses(v),
                  })),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  const key = (r: Input<"receipt">): Receipts.ReceiptKey => ({
    environmentId,
    organizationId: r.organizationId,
    viewer: r.expectedAccountId,
    clientRequestId: r.clientRequestId,
  });
  const receipt = (r: Input<"receipt">) =>
    Effect.gen(function* () {
      const record = yield* receipts.get(key(r));
      if (!record) return yield* fail("not-found");
      return {
        clientRequestId: r.clientRequestId,
        status: record.status,
        itemId: record.itemId,
        item: record.itemId
          ? yield* rawItem({ ...r, spaceId: record.spaceId, id: record.itemId })
          : null,
      };
    });
  const digest = (r: WorkItemCreateInput) =>
    crypto
      .digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify([r.spaceId, r.typeId, r.category, canonical(r.values)]),
        ),
      )
      .pipe(
        Effect.map((bytes) =>
          Array.from(bytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
        ),
        Effect.mapError((cause) => new WorkItemError({ reason: "unavailable", cause })),
      );
  const ensureMembers = (m: WorkItemMetadata, v: WorkItemValues) =>
    parse(() => {
      for (const f of m.fields.filter((f) => ["user", "multiUser"].includes(f.format))) {
        const value = v[f.id];
        if (value === undefined) continue;
        for (const id of Array.isArray(value) ? value : [value])
          if (!m.members.some((u) => u.id === id)) throw fail("invalid-input");
      }
    });
  const create = (r: Input<"create">) =>
    Effect.gen(function* () {
      const payloadHash = yield* digest(r);
      const existing = yield* receipts.get(key(r));
      if (existing) {
        if (existing.payloadHash !== payloadHash) return yield* fail("conflict");
        return yield* receipt(r);
      }
      // Only this pre-reservation stage can authorize editing and a new request key.
      const body = yield* Effect.gen(function* () {
        const m = yield* metadata(r);
        yield* ensureMembers(m, r.values);
        return yield* parse(() => Projex.encodeFields(m.fields, r.values, true));
      }).pipe(
        Effect.mapError((cause) => new WorkItemError({ reason: "create-not-submitted", cause })),
      );
      if (
        !(yield* receipts.reserve(key(r), { spaceId: r.spaceId, typeId: r.typeId, payloadHash }))
      ) {
        const winner = yield* receipts.get(key(r));
        if (winner?.payloadHash !== payloadHash) return yield* fail("conflict");
        return yield* receipt(r);
      }
      // The reservation commits before POST. A crash/timeout never authorizes another POST.
      const outcome = yield* req({
        organizationId: r.organizationId,
        operation: "ProjexCreate",
        body: { ...body, spaceId: r.spaceId, workitemTypeId: r.typeId },
      }).pipe(
        Effect.flatMap((v) => parse(() => decodeCreated(v).id)),
        Effect.result,
      );
      if (outcome._tag === "Failure") {
        yield* receipts.record(key(r), null);
        return yield* receipt(r);
      }
      yield* receipts.record(key(r), outcome.success);
      return yield* receipt(r);
    });
  const update = (r: Input<"update">) =>
    Effect.gen(function* () {
      const before = yield* rawItem(r);
      if (before.gmtModified !== r.expectedModified) return yield* fail("conflict");
      for (const id of Object.keys(r.changes))
        if (!(id in r.previous) || !same(r.previous[id], before.values[id]))
          return yield* fail("conflict");
      const m = yield* metadata({ ...r, typeId: before.typeId, category: before.category });
      yield* ensureMembers(m, r.changes);
      const { status, ...fields } = r.changes;
      const body = yield* parse(() => Projex.encodeFields(m.fields, fields, false));
      if ("description" in fields) {
        if (before.formatType !== "MARKDOWN") return yield* fail("unsupported-field");
        body.formatType = "MARKDOWN";
      }
      if (status !== undefined) {
        const states = yield* req({
          organizationId: r.organizationId,
          operation: "ProjexItemWorkflow",
          params: { id: r.id },
        }).pipe(Effect.flatMap((v) => parse(() => Projex.parseStatuses(v))));
        if (!states.some((s) => s.id === status)) return yield* fail("invalid-input");
        body.status = status;
      }
      if (Object.keys(body).length === 0) return before;
      // shortcut: ProjeX has no CAS. Preflight and readback detect conflicts but cannot exclude external writers between calls.
      yield* req({
        organizationId: r.organizationId,
        operation: "ProjexUpdate",
        params: { id: r.id },
        body,
      }).pipe(Effect.mapError((cause) => new WorkItemError({ reason: "unknown", cause })));
      const after = yield* rawItem(r).pipe(
        Effect.mapError((cause) => new WorkItemError({ reason: "unknown", cause })),
      );
      if (Object.entries(r.changes).some(([id, value]) => !same(after.values[id], value)))
        return yield* fail("unknown");
      return after;
    });
  const relate = (r: Input<"relate">) =>
    Effect.gen(function* () {
      if (r.id === r.targetId) return yield* fail("cycle");
      const item = yield* rawItem(r);
      if (item.gmtModified !== r.expectedModified) return yield* fail("conflict");
      const target = yield* rawItem({ ...r, id: r.targetId });
      const allowed = yield* req({
        organizationId: r.organizationId,
        operation: "ProjexRelationTypes",
        params: { id: item.typeId },
        query: { relationType: r.relationType },
      }).pipe(Effect.flatMap((v) => parse(() => Projex.parseRelationTypes(v))));
      if (!allowed.some((t) => t.id === target.typeId))
        return yield* new WorkItemError({
          reason: "relation-not-allowed",
          relation: { kind: r.relationType, sourceType: item.typeId, targetType: target.typeId },
        });
      const checkType =
        r.relationType === "PARENT" || r.relationType === "SUB" ? "PARENT" : "DEPEND_ON";
      const from = r.relationType === "SUB" || r.relationType === "DEPENDED_BY" ? r.targetId : r.id;
      const to = from === r.id ? r.targetId : r.id;
      if (!r.remove) {
        const pending = [to],
          seen = new Set<string>();
        while (pending.length) {
          const id = pending.pop()!;
          if (id === from) return yield* fail("cycle");
          if (seen.has(id)) continue;
          seen.add(id);
          if (seen.size > 1000) return yield* fail("incomplete");
          const next = yield* edges({ ...r, id }, checkType);
          pending.push(...next.map((e) => e.targetId));
        }
      }
      const current = yield* edges(r, r.relationType);
      const exists = current.some((e) => e.targetId === r.targetId);
      if (exists !== !r.remove)
        yield* req({
          organizationId: r.organizationId,
          operation: r.remove ? "ProjexRemoveRelation" : "ProjexAddRelation",
          params: { id: r.id },
          body: { workitemId: r.targetId, relationType: r.relationType },
        }).pipe(Effect.mapError((cause) => new WorkItemError({ reason: "unknown", cause })));
      const forward = yield* edges(r, r.relationType),
        back = yield* edges({ ...r, id: r.targetId }, reverse[r.relationType]);
      if (
        forward.some((e) => e.targetId === r.targetId) !== !r.remove ||
        back.some((e) => e.targetId === r.id) !== !r.remove
      )
        return yield* fail("unknown");
      return yield* related(r, r.relationType);
    });
  const guarded =
    <K extends Exclude<keyof Operations, "connections">>(
      f: (r: Input<K>) => Effect.Effect<Output<K>, WorkItemError>,
      write = false,
    ) =>
    (r: Input<K>) => {
      const run = Effect.gen(function* () {
        yield* api.verify(r.organizationId, r.expectedAccountId);
        const value = yield* f(r);
        yield* api.verify(r.organizationId, r.expectedAccountId);
        return value;
      });
      return withOrganizationCredential(write ? queue.withPermits(1)(run) : run).pipe(
        Effect.provideService(SourceControlHost.SourceControlHost, host),
        Effect.mapError((cause) =>
          isWorkItemError(cause) ? cause : new WorkItemError({ reason: "unavailable", cause }),
        ),
      );
    };
  return WorkItemsService.of({
    connections: (r) =>
      r.organizationId
        ? api
            .account(r.organizationId)
            .pipe(Effect.map((viewer) => [{ organizationId: r.organizationId!, viewer }]))
        : api.organizations,
    projects: guarded<"projects">((r) =>
      r.page * (r.perPage ?? 20) > 10000
        ? Effect.fail(fail("incomplete"))
        : req({
            organizationId: r.organizationId,
            operation: "ProjexProjects",
            body: { page: r.page, perPage: r.perPage ?? 20 },
          }).pipe(
            Effect.flatMap((v) =>
              parse(() => {
                const items = Projex.parseOptions(v);
                return { items, nextPage: items.length === (r.perPage ?? 20) ? r.page + 1 : null };
              }),
            ),
          ),
    ),
    metadata: guarded<"metadata">(metadata),
    search: guarded<"search">((r) => {
      const filters = (
        [
          ["subject", r.subject, "string", "input"],
          ["status", r.statusId, "status", "list"],
          ["assignedTo", r.assignedTo, "user", "list"],
        ] as const
      )
        .filter(([, v]) => !!v)
        .map(([fieldIdentifier, v, className, format]) => ({
          fieldIdentifier,
          operator: "CONTAINS",
          value: [v],
          toValue: null,
          className,
          format,
        }));
      return r.page * (r.perPage ?? 20) > 10000
        ? Effect.fail(fail("incomplete"))
        : req({
            organizationId: r.organizationId,
            operation: "ProjexSearch",
            body: {
              page: r.page,
              perPage: r.perPage ?? 20,
              spaceId: r.spaceId,
              category: r.category,
              ...(filters.length
                ? { conditions: JSON.stringify({ conditionGroups: [filters] }) }
                : {}),
            },
          }).pipe(
            Effect.flatMap((v) =>
              parse(() => {
                const items = decodeItems(v).map(Projex.parseWorkItem);
                if (items.some((i) => i.spaceId !== r.spaceId)) throw fail("invalid-input");
                return { items, nextPage: items.length === (r.perPage ?? 20) ? r.page + 1 : null };
              }),
            ),
          );
    }),
    get: guarded<"get">((r) =>
      Effect.gen(function* () {
        const item = yield* rawItem(r);
        return {
          item,
          metadata: yield* metadata({ ...r, category: item.category, typeId: item.typeId }),
          relations: (yield* Effect.forEach(relations, (t) => related(r, t))).flat(),
        };
      }),
    ),
    create: guarded<"create">(create, true),
    receipt: guarded<"receipt">(receipt),
    recover: guarded<"recover">(
      (r) =>
        Effect.gen(function* () {
          const record = yield* receipts.get(key(r));
          if (!record) return yield* fail("not-found");
          if (record.payloadHash !== (yield* digest(r))) return yield* fail("conflict");
          if (record.itemId) return yield* receipt(r);
          const item = yield* rawItem({ ...r, id: r.candidateId });
          if (
            item.creatorId !== r.expectedAccountId ||
            item.typeId !== r.typeId ||
            item.category !== r.category ||
            Object.entries(r.values).some(([k, v]) => !same(item.values[k], v))
          )
            return yield* fail("conflict");
          yield* receipts.record(key(r), item.id);
          return yield* receipt(r);
        }),
      true,
    ),
    update: guarded<"update">(update, true),
    relate: guarded<"relate">(relate, true),
    ready: guarded<"ready">((r) =>
      Effect.gen(function* () {
        yield* rawItem(r);
        const all = yield* related(r, "DEPEND_ON");
        if (all.length && r.terminalStatusIds.length === 0) return yield* fail("invalid-input");
        if (
          r.terminalStatusIds.some(
            (id) => !all.some((edge) => edge.statuses.some((s) => s.id === id)),
          ) ||
          all.some(
            (edge) => !r.terminalStatusIds.some((id) => edge.statuses.some((s) => s.id === id)),
          )
        )
          return yield* fail("invalid-input");
        const blockers = all
          .map((x) => x.target)
          .filter((i) => !r.terminalStatusIds.includes(i.status.id));
        return { ready: blockers.length === 0, complete: true, blockers };
      }),
    ),
  });
});
export const layer: Layer.Layer<
  WorkItemsService,
  never,
  | SourceControlHost.SourceControlHost
  | Projex.ProjexApi
  | Receipts.WorkItemCreationReceiptRepository
  | ServerEnvironment.ServerEnvironment
  | Crypto.Crypto
> = Layer.effect(WorkItemsService, make);
