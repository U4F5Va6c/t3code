import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { SourceControlProviderError, type ChangeRequest } from "@t3tools/contracts";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as SourceControlProvider from "@t3tools/source-control-core/server/SourceControlProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { definition } from "../client/definition.ts";
import { parseCodeupRepository, parseCodeupChangeRequest } from "../client/repository.ts";
import * as CodeupApi from "./CodeupApi.ts";
import * as Json from "./codeupJson.ts";

export const make = Effect.gen(function* () {
  const writes = yield* KeyedLock.make<string>();
  const api = yield* CodeupApi.CodeupApi;
  const host = yield* SourceControlHost.SourceControlHost;
  const fs = yield* FileSystem.FileSystem;
  const error = (cwd: string, operation: string, detail: string, cause?: unknown) =>
    new SourceControlProviderError({
      provider: definition.kind,
      cwd,
      operation,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });
  const mapError = (cwd: string, operation: string) => (cause: CodeupApi.CodeupApiError) =>
    error(cwd, operation, cause.message, cause);
  const target = Effect.fn("CodeupSourceControlProvider.target")(function* (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
  }) {
    let remote = input.context?.remoteUrl;
    if (!remote) {
      const remotes = yield* host.git.remotes(input.cwd).pipe(
        Effect.flatten,
        Effect.mapError((cause) =>
          error(input.cwd, "repository", "Could not read Git remotes.", cause),
        ),
      );
      remote = remotes.remotes.find((r) => r.name === "origin")?.url;
    }
    const parsed = parseCodeupRepository(remote ?? "");
    if (!parsed)
      return yield* error(
        input.cwd,
        "repository",
        "This checkout has no Codeup Central Edition remote.",
      );
    return parsed;
  });
  const read = <S extends Schema.Codec<unknown, unknown, never, never>>(
    cwd: string,
    request: CodeupApi.CodeupRequest,
    schema: S,
  ) =>
    api.request(request).pipe(
      Effect.mapError(mapError(cwd, request.operation)),
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError((cause) =>
        cause._tag === "SourceControlProviderError"
          ? cause
          : error(cwd, request.operation, "Codeup returned an unreadable response.", cause),
      ),
    );
  const detail = Effect.fn("CodeupSourceControlProvider.detail")(function* (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly reference: string;
  }) {
    const parsed = parseCodeupChangeRequest(input.reference);
    const repo = parsed ?? (yield* target(input));
    const number = parsed?.number ?? Number(input.reference.replace(/^#/u, ""));
    if (!Number.isSafeInteger(number) || number < 1)
      return yield* error(
        input.cwd,
        "getChangeRequest",
        "Enter a merge request number or Codeup URL.",
      );
    const value = yield* read(
      input.cwd,
      {
        operation: "GetChangeRequest",
        organizationId: repo.organizationId,
        params: { repositoryId: repo.repository, localId: number },
      },
      Json.MergeRequest,
    );
    return { repo, value };
  });
  const convert = (repository: string, value: typeof Json.MergeRequest.Type): ChangeRequest => ({
    provider: definition.kind,
    number: value.localId,
    title: value.title,
    url: Json.summary(repository, value).url,
    baseRefName: value.targetBranch,
    headRefName: value.sourceBranch,
    state: Json.state(value.status),
    isDraft: value.status === "UNDER_DEV",
    updatedAt: DateTime.make(value.updateTime),
    isCrossRepository: value.sourceProjectId !== value.targetProjectId,
    headRepositoryNameWithOwner:
      value.sourceProjectId === value.targetProjectId ? repository : null,
  });
  return SourceControlProvider.SourceControlProvider.of({
    kind: definition.kind,
    headBranchProbe: ({ headSelectors, state }) => ({
      headSelectors: headSelectors.filter((s) => !s.includes(":")),
      limit: state === "open" ? 1 : 20,
    }),
    getRepositoryCloneUrls: (input) =>
      api.getRepository(input.repository).pipe(
        Effect.mapError(mapError(input.cwd, "getRepository")),
        Effect.map((repo) => ({
          nameWithOwner: repo.pathWithNamespace,
          url: repo.httpUrlToRepo,
          sshUrl: repo.sshUrlToRepo,
        })),
      ),
    getDefaultBranch: (input) =>
      target(input).pipe(
        Effect.flatMap((repo) =>
          api
            .getRepository(repo.repository)
            .pipe(Effect.mapError(mapError(input.cwd, "getDefaultBranch"))),
        ),
        Effect.map((repo) => repo.defaultBranch || null),
      ),
    listChangeRequests: Effect.fn("CodeupSourceControlProvider.listChangeRequests")(
      function* (input) {
        const repo = yield* target(input);
        const repository = yield* api
          .getRepository(repo.repository)
          .pipe(Effect.mapError(mapError(input.cwd, "listChangeRequests")));
        const result: ChangeRequest[] = [];
        for (let page = 1; page <= 20; page++) {
          const rows = yield* read(
            input.cwd,
            {
              operation: "ListChangeRequests",
              organizationId: repo.organizationId,
              query: {
                projectIds: repository.id,
                page,
                perPage: 100,
                orderBy: "updated_at",
                sort: "desc",
                ...(input.state === "all"
                  ? {}
                  : { state: input.state === "open" ? "opened" : input.state }),
              },
            },
            Json.MergeRequests,
          );
          for (const row of rows)
            if (
              row.targetProjectId === repository.id &&
              row.sourceBranch === SourceControlProvider.sourceBranch(input)
            )
              result.push(
                convert(repo.repository, {
                  ...row,
                  status: row.state,
                  createTime: row.createdAt,
                  updateTime: row.updatedAt,
                }),
              );
          if (result.length >= (input.limit ?? 20) || rows.length < 100)
            return result.slice(0, input.limit ?? 20);
        }
        return yield* error(
          input.cwd,
          "listChangeRequests",
          "Codeup returned too many merge requests to locate this branch. Open its merge request by URL.",
        );
      },
    ),
    getChangeRequest: Effect.fn("CodeupSourceControlProvider.getChangeRequest")(function* (input) {
      const { repo, value } = yield* detail(input);
      const versions = yield* read(
        input.cwd,
        {
          operation: "ListChangeRequestPatchSets",
          organizationId: repo.organizationId,
          params: { repositoryId: repo.repository, localId: value.localId },
        },
        Json.PatchSets,
      );
      const head = versions
        .filter((p) => p.relatedMergeItemType === "MERGE_SOURCE")
        .toSorted((a, b) => b.versionNo - a.versionNo)[0]?.commitId;
      return { ...convert(repo.repository, value), ...(head ? { headSha: head } : {}) };
    }),
    createChangeRequest: Effect.fn("CodeupSourceControlProvider.createChangeRequest")(
      function* (input) {
        const repo = yield* target(input);
        const source = yield* api
          .getRepository(input.source?.repository ?? repo.repository)
          .pipe(Effect.mapError(mapError(input.cwd, "createChangeRequest")));
        const destination = yield* api
          .getRepository(input.target?.repository ?? repo.repository)
          .pipe(Effect.mapError(mapError(input.cwd, "createChangeRequest")));
        if (
          parseCodeupRepository(source.pathWithNamespace)?.organizationId !== repo.organizationId ||
          parseCodeupRepository(destination.pathWithNamespace)?.organizationId !==
            repo.organizationId
        )
          return yield* error(
            input.cwd,
            "createChangeRequest",
            "Source and target must belong to the same Codeup organization.",
          );
        return yield* writes.withLock(
          [
            source.id,
            destination.id,
            SourceControlProvider.sourceBranch(input),
            input.target?.refName ?? input.baseRefName,
          ].join("\0"),
          Effect.gen(function* () {
            const body = yield* fs
              .readFileString(input.bodyFile)
              .pipe(
                Effect.mapError((cause) =>
                  error(
                    input.cwd,
                    "createChangeRequest",
                    "Could not read the merge request description.",
                    cause,
                  ),
                ),
              );
            if (input.title.length > 256 || body.length > 10_000)
              return yield* error(
                input.cwd,
                "createChangeRequest",
                "Codeup accepts a title up to 256 characters and a description up to 10,000 characters.",
              );
            const existing = Effect.gen(function* () {
              for (let page = 1; page <= 20; page++) {
                const rows = yield* read(
                  input.cwd,
                  {
                    operation: "ListChangeRequests",
                    organizationId: repo.organizationId,
                    query: { projectIds: destination.id, state: "opened", page, perPage: 100 },
                  },
                  Json.MergeRequests,
                );
                const match = rows.find(
                  (mr) =>
                    mr.sourceProjectId === source.id &&
                    mr.targetProjectId === destination.id &&
                    mr.sourceBranch === SourceControlProvider.sourceBranch(input) &&
                    mr.targetBranch === (input.target?.refName ?? input.baseRefName),
                );
                if (match) return true;
                if (rows.length < 100) return false;
              }
              return yield* error(
                input.cwd,
                "createChangeRequest",
                "Could not finish checking for an existing merge request. Open Codeup before retrying.",
              );
            });
            if (yield* existing) return;
            const value = yield* read(
              input.cwd,
              {
                operation: "CreateChangeRequest",
                organizationId: repo.organizationId,
                params: { repositoryId: destination.id },
                body: {
                  sourceProjectId: source.id,
                  targetProjectId: destination.id,
                  sourceBranch: SourceControlProvider.sourceBranch(input),
                  targetBranch: input.target?.refName ?? input.baseRefName,
                  title: input.title,
                  description: body,
                },
              },
              Json.MergeRequest,
            ).pipe(
              Effect.catch((cause) =>
                existing.pipe(
                  Effect.catch(() => Effect.succeed(false)),
                  Effect.flatMap((found) => (found ? Effect.succeed(null) : Effect.fail(cause))),
                ),
              ),
            );
            if (value)
              yield* read(
                input.cwd,
                {
                  operation: "GetChangeRequest",
                  organizationId: repo.organizationId,
                  params: { repositoryId: destination.id, localId: value.localId },
                },
                Json.MergeRequest,
              );
          }),
        );
      },
    ),
    createRepository: Effect.fn("CodeupSourceControlProvider.createRepository")(function* (input) {
      const repo = parseCodeupRepository(input.repository);
      if (!repo || repo.repository.split("/").length !== 2 || input.visibility !== "private")
        return yield* error(
          input.cwd,
          "createRepository",
          "Create a private repository as organization-id/name. Create nested groups or organization-visible repositories on Codeup first, then clone them here.",
        );
      const name = repo.repository.split("/")[1]!;
      const lookup = Effect.suspend(() => api.getRepository(repo.repository));
      const created = yield* writes.withLock(
        `repository:${repo.repository}`,
        Effect.gen(function* () {
          const existing = yield* lookup.pipe(
            Effect.catch((cause) =>
              cause.reason === "not-found" ? Effect.succeed(null) : Effect.fail(cause),
            ),
            Effect.mapError(mapError(input.cwd, "createRepository")),
          );
          const value =
            existing ??
            (yield* read(
              input.cwd,
              {
                operation: "CreateRepository",
                organizationId: repo.organizationId,
                body: { name, path: name, visibility: "private" },
              },
              Schema.Unknown,
            ).pipe(
              Effect.catch((cause) =>
                lookup.pipe(
                  Effect.map(() => undefined),
                  Effect.catch(() => Effect.fail(cause)),
                ),
              ),
              Effect.andThen(lookup.pipe(Effect.mapError(mapError(input.cwd, "createRepository")))),
            ));
          if (
            value.visibility !== "private" ||
            value.archived ||
            value.accessLevel == null ||
            value.accessLevel < 30
          )
            return yield* error(
              input.cwd,
              "createRepository",
              "Codeup has not confirmed a writable private repository. No branch was pushed.",
            );
          return value;
        }),
      );
      return {
        nameWithOwner: created.pathWithNamespace,
        url: created.httpUrlToRepo,
        sshUrl: created.sshUrlToRepo,
      };
    }),
    checkoutChangeRequest: Effect.fn("CodeupSourceControlProvider.checkoutChangeRequest")(
      function* (input) {
        const { repo, value } = yield* detail(input);
        const source = yield* read(
          input.cwd,
          {
            operation: "GetRepository",
            organizationId: repo.organizationId,
            params: { repositoryId: value.sourceProjectId },
          },
          Schema.Struct({ pathWithNamespace: Schema.String }),
        );
        const clone = yield* api
          .getRepository(source.pathWithNamespace)
          .pipe(Effect.mapError(mapError(input.cwd, "checkoutChangeRequest")));
        yield* Effect.gen(function* () {
          const git = host.git;
          const remoteName =
            input.context &&
            parseCodeupRepository(input.context.remoteUrl)?.repository === source.pathWithNamespace
              ? input.context.remoteName
              : yield* git.ensureRemote({
                  cwd: input.cwd,
                  preferredName: "codeup",
                  url: input.context?.remoteUrl.startsWith("https:")
                    ? clone.httpUrlToRepo
                    : clone.sshUrlToRepo,
                });
          const localBranch =
            value.sourceProjectId === value.targetProjectId
              ? value.sourceBranch
              : `mr-${value.localId}/${value.sourceBranch}`;
          const branches = yield* git.listLocalBranchNames(input.cwd);
          const remoteBranch = { cwd: input.cwd, remoteName, remoteBranch: value.sourceBranch };
          if (!input.force && !branches.includes(localBranch))
            yield* git.fetchRemoteBranch({ ...remoteBranch, localBranch });
          else yield* git.fetchRemoteTrackingBranch(remoteBranch);
          if (input.force)
            yield* git.execute({
              operation: "CodeupSourceControlProvider.checkoutChangeRequest",
              cwd: input.cwd,
              args: [
                "checkout",
                "-B",
                localBranch,
                `refs/remotes/${remoteName}/${value.sourceBranch}`,
                "--",
              ],
            });
          yield* git.setBranchUpstream({ ...remoteBranch, branch: localBranch });
          yield* git.switchRef({ cwd: input.cwd, refName: localBranch });
        }).pipe(
          Effect.scoped,
          Effect.mapError((cause) =>
            error(
              input.cwd,
              "checkoutChangeRequest",
              "Could not check out the Codeup merge request.",
              cause,
            ),
          ),
        );
      },
    ),
    resolveLink: (input) =>
      parseCodeupChangeRequest(input.url.toString())
        ? detail({ cwd: input.cwd, reference: input.url.toString() }).pipe(
            Effect.map(({ value }) => ({ title: value.title, body: value.description ?? null })),
          )
        : undefined,
  });
});
