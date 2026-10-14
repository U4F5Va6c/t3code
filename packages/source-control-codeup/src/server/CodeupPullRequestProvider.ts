import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import {
  type PullRequestCapabilities,
  type PullRequestViewerPermissions,
} from "@t3tools/contracts";
import {
  PullRequestProviderError,
  type ProviderRepositoryRef,
  type ProviderChangeRequest,
  type PullRequestProviderApi,
} from "@t3tools/source-control-core/server/PullRequestProvider";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { definition } from "../client/definition.ts";
import { CODEUP_HOST, parseCodeupRepository } from "../client/repository.ts";
import * as CodeupApi from "./CodeupApi.ts";
import * as Json from "./codeupJson.ts";

const decodeChecks = Schema.decodeUnknownEffect(Json.Checks);
const decodeViewer = Schema.decodeUnknownEffect(Json.Viewer);

type Ref = ProviderRepositoryRef & { readonly number: number };
const capabilities: PullRequestCapabilities = {
  diff: true,
  comment: true,
  search: true,
  actions: ["close", "reopen", "merge"],
  mergeMethods: ["merge", "squash", "rebase"],
  viewedFiles: "environment",
  // T3's review drafts carry no patch-set identity. Do not attach old lines to a new version.
  review: {
    inlineComment: false,
    reply: true,
    resolve: true,
    verdicts: ["approve", "request-changes", "comment"],
  },
  reviewers: { request: true, listCandidates: true },
  edit: { changeRequest: true, comment: true },
};

export const make = Effect.gen(function* () {
  const api = yield* CodeupApi.CodeupApi;
  const host = yield* SourceControlHost.SourceControlHost;
  const failure = (operation: string, detail: string, cause?: unknown) =>
    new PullRequestProviderError({
      provider: definition.kind,
      operation,
      reason: "failed",
      detail,
      ...(cause === undefined ? {} : { cause: Redacted.make(cause) }),
    });
  const mapError = (operation: string) => (cause: CodeupApi.CodeupApiError) =>
    new PullRequestProviderError({
      provider: definition.kind,
      operation,
      reason:
        cause.reason === "not-configured" || cause.reason === "unauthenticated"
          ? "unauthenticated"
          : cause.reason === "not-found" || cause.reason === "rate-limited"
            ? cause.reason
            : "failed",
      detail: cause.message,
      cause,
    });
  const target = (input: ProviderRepositoryRef) => {
    const parsed = parseCodeupRepository(input.repository);
    return input.host === CODEUP_HOST && parsed
      ? Effect.succeed(parsed)
      : Effect.fail(failure("repository", "Expected a Codeup Central Edition repository."));
  };
  const read = <S extends Schema.Codec<unknown, unknown, never, never>>(
    input: ProviderRepositoryRef,
    request: Omit<CodeupApi.CodeupRequest, "organizationId">,
    schema: S,
  ) =>
    Effect.gen(function* () {
      const repo = yield* target(input);
      const raw = yield* api
        .request({
          ...request,
          organizationId: repo.organizationId,
          params: { repositoryId: repo.repository, ...request.params },
        })
        .pipe(Effect.mapError(mapError(request.operation)));
      return yield* Schema.decodeUnknownEffect(schema)(raw).pipe(
        Effect.mapError((cause) =>
          failure(request.operation, "Codeup returned an unreadable response.", cause),
        ),
      );
    });
  const mr = Effect.fn("CodeupPullRequestProvider.mr")(function* (input: Ref) {
    const value = yield* read(
      input,
      { operation: "GetChangeRequest", params: { localId: input.number } },
      Json.MergeRequest,
    );
    const repository = value.detailUrl
      ? null
      : yield* api.getRepository(input.repository).pipe(Effect.mapError(mapError("repository")));
    const url = value.detailUrl ? parseChangeRequestUrl(value.detailUrl) : null;
    if (
      value.localId !== input.number ||
      (repository !== null && value.targetProjectId !== repository.id) ||
      (value.detailUrl &&
        (url === null ||
          url.host !== input.host ||
          url.repository !== input.repository.toLowerCase() ||
          url.number !== input.number))
    )
      return yield* failure("identity", "Codeup returned another merge request or repository.");
    return value;
  });
  const patches = (input: Ref) =>
    read(
      input,
      { operation: "ListChangeRequestPatchSets", params: { localId: input.number } },
      Json.PatchSets,
    ).pipe(
      Effect.flatMap((all) => {
        const latest = (type: string) =>
          all
            .filter((p) => p.relatedMergeItemType === type)
            .toSorted((a, b) => b.versionNo - a.versionNo)[0];
        const source = latest("MERGE_SOURCE"),
          base = latest("MERGE_TARGET");
        return source && base
          ? Effect.succeed({ source, base })
          : Effect.fail(
              failure("patchSets", "Codeup has not produced a source and target patch set yet."),
            );
      }),
    );
  const comparison = Effect.fn("CodeupPullRequestProvider.comparison")(function* (
    input: Ref & { readonly commit?: string | undefined },
  ) {
    const versions = yield* patches(input);
    const comparison = (from: string, to: string, straight: boolean) =>
      read(
        input,
        { operation: "GetCompare", query: { from, to, straight: String(straight) } },
        Json.Compare,
      );
    const current = yield* comparison(versions.base.commitId, versions.source.commitId, false);
    if (input.commit) {
      const commit = current.commits.find((commit) => commit.id === input.commit);
      if (!commit)
        return yield* failure(
          "diff",
          "This commit is no longer part of the merge request. Refresh before reviewing.",
        );
      if (!commit.parentIds[0])
        return yield* failure("diff", "A root commit has no comparison parent.");
      return { ...versions, compare: yield* comparison(commit.parentIds[0], commit.id, true) };
    }
    return { ...versions, compare: current };
  });
  const permissions = Effect.fn("CodeupPullRequestProvider.permissions")(function* (
    input: Ref,
  ): Effect.fn.Return<PullRequestViewerPermissions, PullRequestProviderError> {
    yield* target(input);
    const repo = yield* api
      .getRepository(input.repository)
      .pipe(Effect.mapError(mapError("permissions")));
    // Missing accessLevel is not a denial; the mutation endpoint still enforces membership,
    // protected branches, review requirements, and CI gates at execution time.
    const write = !repo.archived && (repo.accessLevel == null || repo.accessLevel >= 30);
    return {
      actions: write ? [...capabilities.actions] : [],
      comment: write,
      resolve: write,
      verdicts: write ? [...capabilities.review.verdicts] : [],
      requestReviewers: write,
      editChangeRequest: write,
    };
  });
  const checks = (input: Ref, versions: Awaited<Effect.Success<ReturnType<typeof patches>>>) =>
    read(
      input,
      {
        operation: "ListChangeRequestCICheckList",
        params: { localId: input.number },
        query: { patchSetBizId: versions.source.patchSetBizId },
      },
      Schema.Unknown,
    ).pipe(
      Effect.flatMap((raw) => decodeChecks(Json.normalizeChecks(raw))),
      Effect.mapError((cause) =>
        cause._tag === "PullRequestProviderError"
          ? cause
          : failure("checks", "Codeup returned unreadable checks.", cause),
      ),
      Effect.map((data) => Json.checks(data, versions.source.commitId)),
    );
  const write = (input: Ref, request: Omit<CodeupApi.CodeupRequest, "organizationId">) =>
    read(
      input,
      { ...request, params: { localId: input.number, ...request.params } },
      Schema.Unknown,
    ).pipe(
      Effect.flatMap((result) => {
        if (
          result === false ||
          (typeof result === "object" &&
            result !== null &&
            "result" in result &&
            result.result === false)
        )
          return Effect.fail(
            failure(
              request.operation,
              "Codeup did not accept this operation. Refresh before trying again.",
            ),
          );
        return Effect.void;
      }),
    );
  const comment = Effect.fn("CodeupPullRequestProvider.comment")(function* (
    input: Ref & {
      readonly body: string;
      readonly threadId?: string;
      readonly expectedHeadSha?: string;
    },
  ) {
    const versions = yield* patches(input);
    if (input.expectedHeadSha !== undefined && input.expectedHeadSha !== versions.source.commitId)
      return yield* failure(
        "review",
        "The merge request changed before the comment was posted. Refresh and review the current diff.",
      );
    yield* write(input, {
      operation: "CreateChangeRequestComment",
      body: {
        content: input.body,
        comment_type: "GLOBAL_COMMENT",
        draft: false,
        resolved: false,
        patchset_biz_id: versions.source.patchSetBizId,
        ...(input.threadId ? { parent_comment_biz_id: input.threadId } : {}),
      },
    });
  });

  return {
    kind: definition.kind,
    capabilities,
    getViewer: Effect.fn("CodeupPullRequestProvider.getViewer")(function* (input) {
      const remotes = yield* host.git.remotes(input.cwd).pipe(
        Effect.flatten,
        Effect.mapError((cause) =>
          failure("viewer", "Could not resolve the Codeup repository.", cause),
        ),
      );
      const repo = remotes.remotes.map((r) => parseCodeupRepository(r.url)).find((r) => r !== null);
      const raw = yield* api
        .request({
          operation: "GetUserByToken",
          ...(repo ? { organizationId: repo.organizationId } : {}),
        })
        .pipe(Effect.mapError(mapError("viewer")));
      const user = yield* decodeViewer(raw).pipe(
        Effect.mapError((cause) =>
          failure("viewer", "Codeup did not return an account identity.", cause),
        ),
      );
      return user.id;
    }),
    listChangeRequests: Effect.fn("CodeupPullRequestProvider.listChangeRequests")(
      function* (input) {
        const repository = yield* api
          .getRepository(input.repository)
          .pipe(Effect.mapError(mapError("listChangeRequests")));
        // T3's shared viewer cache is host-scoped; Codeup credentials are organization-scoped.
        const viewer = yield* read(input, { operation: "GetUserByToken" }, Json.Viewer);
        const offset = input.cursor?.delivered ?? 0;
        const items: Array<ProviderChangeRequest> = [];
        let consumed = 0,
          more = true;
        // A fixed page size keeps continuation stable when the client changes its slice size.
        for (let page = Math.floor(offset / 100) + 1; more && items.length < input.limit; page++) {
          const rows = yield* read(
            input,
            {
              operation: "ListChangeRequests",
              query: {
                projectIds: repository.id,
                page,
                perPage: 100,
                orderBy: "updated_at",
                sort: "desc",
                ...(input.state === "all"
                  ? {}
                  : { state: input.state === "open" ? "opened" : input.state }),
                ...(input.query ? { search: input.query } : {}),
                ...(input.involvement === "authored"
                  ? { authorIds: viewer.id }
                  : input.involvement === "reviewing"
                    ? { reviewerIds: viewer.id }
                    : {}),
              },
            },
            Json.MergeRequests,
          );
          if (rows.some((row) => row.targetProjectId !== repository.id))
            return yield* failure(
              "listChangeRequests",
              "Codeup returned merge requests for another repository.",
            );
          const start = page === Math.floor(offset / 100) + 1 ? offset % 100 : 0;
          const slice = rows.slice(start, start + input.limit - items.length);
          for (const row of slice)
            items.push({
              viewer: viewer.id,
              ...Json.summary(input.repository, {
                ...row,
                status: row.state,
                createTime: row.createdAt,
                updateTime: row.updatedAt,
                conflictCheckStatus:
                  row.hasConflict === true
                    ? "HAS_CONFLICT"
                    : row.hasConflict === false
                      ? "NO_CONFLICT"
                      : null,
              }),
            });
          consumed += slice.length;
          more = start + slice.length < rows.length || rows.length === 100;
          if (!slice.length) break;
        }
        return { items, truncated: more, continues: true, cursorAdvance: consumed };
      },
    ),
    listChangeRequestStats: (input) =>
      Effect.forEach(
        input.changeRequests,
        (ref) =>
          comparison({ ...input, ...ref }).pipe(
            Effect.map(({ compare }) => ({ ...ref, ...Json.stats(compare) })),
          ),
        { concurrency: 4 },
      ),
    getChangeRequestSummary: (input) =>
      mr(input).pipe(Effect.map((value) => Json.summary(input.repository, value))),
    getChangeRequestPreview: (input) =>
      mr(input).pipe(Effect.map((value) => Json.summary(input.repository, value))),
    getChangeRequest: Effect.fn("CodeupPullRequestProvider.getChangeRequest")(function* (input) {
      const [value, compared, viewerPermissions, viewer] = yield* Effect.all(
        [
          mr(input),
          comparison(input),
          permissions(input),
          read(input, { operation: "GetUserByToken" }, Json.Viewer),
        ],
        { concurrency: 4 },
      );
      const checkList = yield* checks(input, compared);
      return {
        ...Json.summary(input.repository, value),
        ...Json.stats(compared.compare),
        headSha: compared.source.commitId,
        body: value.description ?? "",
        reviewers: value.reviewers.map((u) => Json.actor(u)!),
        checks: checkList,
        viewerPermissions,
        viewer: viewer.id,
        mergeCapabilities: { merge: true, squash: true, rebase: true },
        ...(value.behind == null
          ? {}
          : {
              baseComparison: value.behind > 0 ? ("behind" as const) : ("up-to-date" as const),
              behindBy: value.behind,
            }),
      };
    }),
    getChangeRequestChecks: Effect.fn("CodeupPullRequestProvider.getChangeRequestChecks")(
      function* (input) {
        const [value, versions] = yield* Effect.all([mr(input), patches(input)], {
          concurrency: 2,
        });
        return { state: Json.state(value.status), checks: yield* checks(input, versions) };
      },
    ),
    getChangeRequestActivity: Effect.fn("CodeupPullRequestProvider.getChangeRequestActivity")(
      function* (input) {
        const [value, compared, comments] = yield* Effect.all(
          [
            mr(input),
            comparison(input),
            read(
              input,
              { operation: "ListMergeRequestComments", params: { localId: input.number } },
              Json.Comments,
            ),
          ],
          { concurrency: 3 },
        );
        const activity = Json.activity(
          comments,
          compared.source.patchSetBizId,
          compared.base.patchSetBizId,
        );
        const count = value.totalCommentCount ?? activity.comments.length;
        return {
          ...activity,
          comments: [...activity.comments, ...Json.reviewActivity(value.reviewers)],
          commentCount: count,
          commentsTruncated: count > activity.comments.length,
          reviewThreadsTruncated: count > activity.comments.length,
          commits: compared.compare.commits.map((c) => ({
            oid: c.id,
            messageHeadline: c.title,
            committedDate: c.committedDate,
            authors: c.authorName
              ? [{ login: c.authorName, name: c.authorName, avatarUrl: null }]
              : [],
          })),
        };
      },
    ),
    getViewerPermissions: permissions,
    getDiff: (input) => comparison(input).pipe(Effect.map(({ compare }) => Json.patch(compare))),
    getDiffFileContents: Effect.fn("CodeupPullRequestProvider.getDiffFileContents")(
      function* (input) {
        const { compare, source, base } = yield* comparison(input);
        const file = compare.diffs.find(
          (f) => f.oldPath === input.oldPath && f.newPath === input.newPath,
        );
        if (!file)
          return yield* failure(
            "fileContents",
            "This file is no longer in the current diff. Refresh the merge request.",
          );
        if (file.isBinary)
          return yield* failure("fileContents", "Binary files cannot be expanded as text.");
        const contents = (id: string | null | undefined) => {
          if (!id || !/^[a-f0-9]{40,64}$/iu.test(id))
            return Effect.fail(
              failure("fileContents", "Codeup did not identify the file revision."),
            );
          return host.git
            .execute({
              operation: "CodeupPullRequestProvider.fileContents",
              cwd: input.cwd,
              args: ["cat-file", "blob", id],
              maxOutputBytes: 8 * 1024 * 1024,
            })
            .pipe(
              Effect.flatMap((result) =>
                result.stdoutTruncated
                  ? Effect.fail(failure("fileContents", "This file is too large to expand."))
                  : Effect.succeed(result.stdout),
              ),
            );
        };
        const both = Effect.all(
          [
            file.newFile ? Effect.succeed("") : contents(file.oldId),
            file.deletedFile ? Effect.succeed("") : contents(file.newId),
          ],
          { concurrency: 2 },
        );
        const result = yield* both.pipe(
          Effect.catchTags({
            GitCommandError: () =>
              Effect.gen(function* () {
                const repository = yield* api
                  .getRepository(input.repository)
                  .pipe(Effect.mapError(mapError("fileContents")));
                const remotes = yield* host.git.remotes(input.cwd).pipe(Effect.flatten);
                const remote = remotes.remotes.find(
                  (remote) => parseCodeupRepository(remote.url)?.repository === input.repository,
                );
                // Read exact blob IDs from the patch; a moving target branch is not the diff's base.
                yield* host.git.execute({
                  operation: "CodeupPullRequestProvider.fetchContents",
                  cwd: input.cwd,
                  args: [
                    "fetch",
                    "--no-tags",
                    "--no-write-fetch-head",
                    "--",
                    remote?.name ?? repository.sshUrlToRepo,
                    source.commitId,
                    base.commitId,
                  ],
                });
                return yield* both;
              }),
          }),
          Effect.mapError((cause) =>
            cause._tag === "PullRequestProviderError"
              ? cause
              : failure(
                  "fileContents",
                  "Could not fetch these exact file revisions using this environment's Git credentials.",
                  cause,
                ),
          ),
        );
        return { oldContents: result[0], newContents: result[1] };
      },
    ),
    getFileRevisions: (input) =>
      comparison(input).pipe(
        Effect.map(({ compare }) => ({
          revisions: new Map(
            compare.diffs.flatMap((f) =>
              f.deletedFile
                ? [[f.oldPath, ""] as const]
                : f.newId
                  ? [[f.newPath, f.newId] as const]
                  : [],
            ),
          ),
          complete: true,
        })),
      ),
    runAction: Effect.fn("CodeupPullRequestProvider.runAction")(function* (input) {
      if (input.action === "close" || input.action === "reopen") {
        const desired = input.action === "close" ? "closed" : "open";
        if (Json.state((yield* mr(input)).status) === desired) return;
        yield* write(input, {
          operation: input.action === "close" ? "CloseChangeRequest" : "ReopenChangeRequest",
        }).pipe(
          Effect.catch((error) =>
            mr(input).pipe(
              Effect.matchEffect({
                onFailure: () => Effect.fail(error),
                onSuccess: (after) =>
                  Json.state(after.status) === desired ? Effect.void : Effect.fail(error),
              }),
            ),
          ),
        );
        const after = yield* mr(input);
        if (Json.state(after.status) !== (input.action === "close" ? "closed" : "open"))
          return yield* failure(
            input.action,
            "Codeup has not confirmed the requested state. Refresh before retrying.",
          );
      } else if (input.action === "merge") {
        const before = yield* mr(input);
        if (before.allRequirementsPass !== true || before.conflictCheckStatus !== "NO_CONFLICT")
          return yield* failure(
            "merge",
            "Codeup merge requirements have not passed, or the conflict check is incomplete. Review the merge request on Codeup.",
          );
        const versions = yield* patches(input);
        if (
          input.expectedHeadSha !== undefined &&
          input.expectedHeadSha !== versions.source.commitId
        )
          return yield* failure("merge", "The merge request head changed. Refresh before merging.");
        const currentChecks = yield* checks(input, versions);
        if (currentChecks.some((check) => check.required && check.status !== "success"))
          return yield* failure(
            "merge",
            "Required checks have not passed for the current Codeup patch set.",
          );
        const latest = yield* patches(input);
        if (
          latest.source.commitId !== versions.source.commitId ||
          latest.base.commitId !== versions.base.commitId
        )
          return yield* failure(
            "merge",
            "The merge request changed while its checks were read. Refresh before merging.",
          );
        const finalRequest = yield* mr(input);
        if (
          finalRequest.targetBranch !== before.targetBranch ||
          finalRequest.sourceBranch !== before.sourceBranch ||
          finalRequest.sourceProjectId !== before.sourceProjectId ||
          finalRequest.targetProjectId !== before.targetProjectId ||
          finalRequest.allRequirementsPass !== true ||
          finalRequest.conflictCheckStatus !== "NO_CONFLICT"
        )
          return yield* failure(
            "merge",
            "The merge request target or requirements changed. Refresh before merging.",
          );
        // No bypass flag: Codeup checks its own gates. Its merge API has no expected-head
        // parameter, so a preflight cannot promise atomic head fencing.
        yield* write(input, {
          operation: "MergeChangeRequest",
          body: {
            mergeType:
              input.mergeMethod === "squash"
                ? "squash"
                : input.mergeMethod === "rebase"
                  ? "rebase"
                  : "no-fast-forward",
            removeSourceBranch: false,
          },
        });
        if ((yield* mr(input)).status !== "MERGED")
          return yield* failure(
            "merge",
            "Codeup has not confirmed the merge. Refresh before retrying.",
          );
      } else return yield* failure(input.action, "This action is not supported by Codeup.");
    }),
    updateChangeRequest: Effect.fn("CodeupPullRequestProvider.updateChangeRequest")(
      function* (input) {
        const matches = (value: typeof Json.MergeRequest.Type) =>
          (input.title === undefined || value.title === input.title) &&
          (input.body === undefined || (value.description ?? "") === input.body);
        if (matches(yield* mr(input))) return;
        yield* write(input, {
          operation: "UpdateChangeRequest",
          body: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.body !== undefined ? { description: input.body } : {}),
          },
        }).pipe(
          Effect.catch((error) =>
            mr(input).pipe(
              Effect.matchEffect({
                onFailure: () => Effect.fail(error),
                onSuccess: (after) => (matches(after) ? Effect.void : Effect.fail(error)),
              }),
            ),
          ),
        );
        if (!matches(yield* mr(input)))
          return yield* failure(
            "update",
            "Codeup has not confirmed the requested fields. Refresh before retrying.",
          );
      },
    ),
    comment,
    updateComment: (input) =>
      write(input, {
        operation: "UpdateChangeRequestComment",
        params: { commentBizId: input.commentId },
        body: { content: input.body },
      }),
    submitReview: Effect.fn("CodeupPullRequestProvider.submitReview")(function* (input) {
      if (input.comments.length)
        return yield* failure(
          "review",
          "Inline review drafts require a patch-set identity and are not supported in this build.",
        );
      const versions = yield* patches(input);
      if (!input.expectedHeadSha || input.expectedHeadSha !== versions.source.commitId)
        return yield* failure(
          "review",
          "The merge request changed since it was displayed. Refresh and review the current diff before submitting.",
        );
      if (input.verdict === "comment") {
        if (input.body.trim()) yield* comment(input);
      } else
        yield* write(input, {
          operation: "ReviewChangeRequest",
          body: {
            reviewOpinion: input.verdict === "approve" ? "PASS" : "NOT_PASS",
            reviewComment: input.body,
          },
        });
      const after = yield* patches(input);
      if (after.source.commitId !== versions.source.commitId)
        return yield* failure(
          "review",
          "Codeup accepted the review while the head changed. Check the review on Codeup before continuing.",
        );
    }),
    listReviewerCandidates: Effect.fn("CodeupPullRequestProvider.listReviewerCandidates")(
      function* (input) {
        const [value, members] = yield* Effect.all(
          [mr(input), read(input, { operation: "ListRepositoryMembers" }, Json.Members)],
          { concurrency: 2 },
        );
        return {
          candidates: members
            .filter((u) => u.userId && u.userId !== value.author?.userId && u.state !== "blocked")
            .map((u) => ({
              id: u.userId!,
              kind: "user" as const,
              login: u.userId!,
              name: u.name || u.username || u.userId!,
              avatarUrl: u.avatarUrl ?? null,
              isRequested: value.reviewers.some((r) => r.userId === u.userId),
            })),
          truncated: false,
        };
      },
    ),
    setReviewerRequest: Effect.fn("CodeupPullRequestProvider.setReviewerRequest")(
      function* (input) {
        const value = yield* mr(input);
        const ids = new Set(value.reviewers.map((u) => u.userId));
        for (const reviewer of input.reviewers) {
          if (reviewer.kind !== "user")
            return yield* failure("reviewers", "Codeup supports individual reviewers.");
          if (input.requested) ids.add(reviewer.id);
          else ids.delete(reviewer.id);
        }
        yield* write(input, {
          operation: "UpdateChangeRequestRelatedPerson",
          params: { type: "REVIEWER" },
          body: { userIds: [...ids] },
        });
      },
    ),
    replyToThread: (input) => comment(input),
    setThreadResolution: (input) =>
      write(input, {
        operation: "UpdateChangeRequestComment",
        params: { commentBizId: input.threadId },
        body: { resolved: input.resolved },
      }),
    setReaction: () => Effect.fail(failure("reaction", "Codeup reactions are not supported.")),
  } satisfies PullRequestProviderApi;
});
