import {
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
  type PullRequestCheck,
  type PullRequestComment,
  type PullRequestReviewThread,
} from "@t3tools/contracts";
import { quoteGitPatchPath } from "@t3tools/shared/gitPatchPath";
import * as Schema from "effect/Schema";
import { codeupRepositoryUrl } from "../client/repository.ts";

const text = Schema.optional(Schema.NullOr(Schema.String));
const bool = Schema.optional(Schema.NullOr(Schema.Boolean));
const count = Schema.optional(Schema.NullOr(NonNegativeInt));
export const User = Schema.Struct({
  userId: TrimmedNonEmptyString,
  username: text,
  name: text,
  avatar: text,
  hasReviewed: bool,
  reviewOpinionStatus: text,
  reviewTime: text,
});
export const Viewer = Schema.Struct({ id: TrimmedNonEmptyString, name: text, username: text });
const states = Schema.Literals(["UNDER_DEV", "UNDER_REVIEW", "TO_BE_MERGED", "CLOSED", "MERGED"]);
const common = {
  bizId: text,
  detailUrl: text,
  localId: PositiveInt,
  title: TrimmedNonEmptyString,
  sourceBranch: TrimmedNonEmptyString,
  targetBranch: TrimmedNonEmptyString,
  sourceProjectId: PositiveInt,
  targetProjectId: PositiveInt,
  author: Schema.NullOr(User),
  reviewers: Schema.Array(User),
  description: text,
  totalCommentCount: count,
};
export const MergeRequest = Schema.Struct({
  ...common,
  status: states,
  createTime: Schema.String,
  updateTime: Schema.String,
  conflictCheckStatus: text,
  allRequirementsPass: bool,
  behind: count,
});
export const MergeRequests = Schema.Array(
  Schema.Struct({
    ...common,
    state: states,
    createdAt: Schema.String,
    updatedAt: Schema.String,
    hasConflict: bool,
  }),
);
export const PatchSets = Schema.Array(
  Schema.Struct({
    commitId: TrimmedNonEmptyString,
    patchSetBizId: TrimmedNonEmptyString,
    relatedMergeItemType: Schema.Literals(["MERGE_SOURCE", "MERGE_TARGET"]),
    versionNo: NonNegativeInt,
    ref: text,
  }),
);
export const Commit = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: Schema.String,
  committedDate: Schema.String,
  authorName: text,
  parentIds: Schema.Array(Schema.String),
});
export const Compare = Schema.Struct({
  commits: Schema.Array(Commit),
  diffs: Schema.Array(
    Schema.Struct({
      oldPath: Schema.String,
      newPath: Schema.String,
      oldId: text,
      newId: text,
      aMode: text,
      bMode: text,
      diff: text,
      newFile: bool,
      deletedFile: bool,
      renamedFile: bool,
      isBinary: bool,
    }),
  ),
});
export const Members = Schema.Array(
  Schema.Struct({ userId: text, username: text, name: text, avatarUrl: text, state: text }),
);
export const Blob = Schema.Struct({
  content: Schema.String,
  encoding: Schema.Literals(["text", "base64"]),
  blobId: TrimmedNonEmptyString,
});
const commentFields = {
  comment_biz_id: TrimmedNonEmptyString,
  content: Schema.String,
  author: Schema.NullOr(User),
  comment_time: Schema.String,
  last_edit_time: text,
  comment_type: Schema.String,
  state: text,
  filePath: text,
  line_number: count,
  resolved: bool,
  out_dated: bool,
  is_deleted: bool,
  parent_comment_biz_id: text,
  root_comment_biz_id: text,
  from_patchset_biz_id: text,
  to_patchset_biz_id: text,
  related_patchset: Schema.optional(Schema.NullOr(Schema.Struct({ patchSetBizId: Schema.String }))),
  location: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        can_located: bool,
        located_file_path: text,
        located_line_number: count,
        located_patch_set_biz_id: text,
      }),
    ),
  ),
};
export const Comment = Schema.Struct(commentFields);
export const Comments = Schema.Array(
  Schema.Struct({
    ...commentFields,
    child_comments_list: Schema.optional(Schema.NullOr(Schema.Array(Comment))),
  }),
);
export const Checks = Schema.Struct({
  latest: Schema.Boolean,
  status: text,
  itemCount: NonNegativeInt,
  checkList: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          taskName: Schema.String,
          state: Schema.String,
          buildUrl: text,
          required: bool,
          invalid: bool,
        }),
      ),
    ),
  ),
  commitStatuses: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          context: Schema.String,
          state: Schema.String,
          sha: Schema.String,
          description: text,
          targetUrl: text,
          required: bool,
        }),
      ),
    ),
  ),
  checkRuns: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        tiledCheckRuns: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
      }),
    ),
  ),
});
export const actor = (user: typeof User.Type | null) =>
  user
    ? {
        login: user.userId,
        name: user.name || user.username || user.userId,
        avatarUrl: user.avatar ?? null,
      }
    : null;
export const state = (value: typeof states.Type) =>
  value === "MERGED"
    ? ("merged" as const)
    : value === "CLOSED"
      ? ("closed" as const)
      : ("open" as const);
export const summary = (repository: string, mr: typeof MergeRequest.Type) => ({
  nativeIdentity: {
    repositoryId: mr.targetProjectId,
    localId: mr.localId,
    ...(mr.bizId ? { bizId: mr.bizId } : {}),
    sourceRepositoryId: mr.sourceProjectId,
    targetRepositoryId: mr.targetProjectId,
  },
  number: mr.localId,
  title: mr.title,
  url: mr.detailUrl || `${codeupRepositoryUrl(repository)}/change/${mr.localId}`,
  headBranch: mr.sourceBranch,
  baseBranch: mr.targetBranch,
  state: state(mr.status),
  isDraft: mr.status === "UNDER_DEV",
  createdAt: mr.createTime,
  updatedAt: mr.updateTime,
  closedAt: null,
  mergedAt: null,
  author: actor(mr.author),
  mergeability:
    mr.conflictCheckStatus === "HAS_CONFLICT"
      ? ("conflicting" as const)
      : mr.conflictCheckStatus === "NO_CONFLICT"
        ? ("mergeable" as const)
        : ("unknown" as const),
  additions: 0,
  deletions: 0,
  labels: [],
  reviewRequestLogins: mr.reviewers.filter((u) => !u.hasReviewed).map((u) => u.userId),
});
export function reviewActivity(reviewers: ReadonlyArray<typeof User.Type>): PullRequestComment[] {
  return reviewers.flatMap((reviewer) => {
    const reviewState =
      reviewer.reviewOpinionStatus === "PASS"
        ? "APPROVED"
        : reviewer.reviewOpinionStatus === "NOT_PASS"
          ? "CHANGES_REQUESTED"
          : null;
    return reviewer.hasReviewed && reviewState && reviewer.reviewTime
      ? [
          {
            id: `review:${reviewer.userId}:${reviewer.reviewTime}`,
            kind: "review" as const,
            author: actor(reviewer),
            body: "",
            createdAt: reviewer.reviewTime,
            url: null,
            path: null,
            reviewState,
            viewerCanEdit: false,
          },
        ]
      : [];
  });
}

export function patch(compare: typeof Compare.Type) {
  let truncated = false;
  const sections = compare.diffs.map((f) => {
    let hunks = f.diff ?? "";
    // Codeup includes ---/+++ on new files, but not on all modified files.
    hunks = hunks.replace(/^---[^\n]*\n\+\+\+[^\n]*\n/u, "");
    if (!hunks && !f.isBinary && f.oldId !== f.newId && !f.renamedFile) truncated = true;
    const header = [
      `diff --git ${quoteGitPatchPath(`a/${f.oldPath}`)} ${quoteGitPatchPath(`b/${f.newPath}`)}`,
      ...(f.newFile ? [`new file mode ${f.bMode || "100644"}`] : []),
      ...(f.deletedFile ? [`deleted file mode ${f.aMode || "100644"}`] : []),
      ...(f.renamedFile
        ? [
            `rename from ${quoteGitPatchPath(f.oldPath)}`,
            `rename to ${quoteGitPatchPath(f.newPath)}`,
          ]
        : []),
      ...(f.oldId && f.newId ? [`index ${f.oldId}..${f.newId}`] : []),
      ...(f.isBinary
        ? [
            `Binary files ${quoteGitPatchPath(`a/${f.oldPath}`)} and ${quoteGitPatchPath(`b/${f.newPath}`)} differ`,
          ]
        : [
            `--- ${f.newFile ? "/dev/null" : quoteGitPatchPath(`a/${f.oldPath}`)}`,
            `+++ ${f.deletedFile ? "/dev/null" : quoteGitPatchPath(`b/${f.newPath}`)}`,
          ]),
    ].join("\n");
    return `${header}\n${hunks}${hunks && !hunks.endsWith("\n") ? "\n" : ""}`;
  });
  return { patch: sections.join(""), truncated, nextCursor: null };
}
export const stats = (compare: typeof Compare.Type) => {
  let additions = 0,
    deletions = 0;
  for (const f of compare.diffs)
    for (const line of (f.diff ?? "").split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }
  return { additions, deletions, changedFiles: compare.diffs.length };
};
const checkStatus = (value: string): PullRequestCheck["status"] => {
  switch (value.toUpperCase()) {
    case "PASS":
    case "SUCCESS":
      return "success";
    case "FAIL":
    case "FAILED":
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "CANCELLED":
    case "CANCELED":
      return "cancelled";
    default:
      return "pending";
  }
};
export function checks(data: typeof Checks.Type, head: string): PullRequestCheck[] {
  const results: PullRequestCheck[] = (data.checkList ?? []).map((c) => ({
    name: c.taskName || "Codeup CI",
    status: data.latest && !c.invalid ? checkStatus(c.state) : "pending",
    description: c.invalid || !data.latest ? "Result is no longer current." : null,
    url: c.buildUrl ?? null,
    required: c.required ?? false,
  }));
  for (const c of data.commitStatuses ?? [])
    results.push({
      name: c.context || "Commit status",
      status: data.latest && c.sha === head ? checkStatus(c.state) : "pending",
      description: c.sha === head ? (c.description ?? null) : "Result belongs to another commit.",
      url: c.targetUrl ?? null,
      required: c.required ?? false,
    });
  // Check-run payloads are not specified by this API. Preserve the host rollup, never
  // turn unrecognised individual results into a passing check.
  if (data.itemCount > results.length || data.checkRuns?.tiledCheckRuns?.length)
    results.push({
      name: "Codeup checks",
      status: data.latest ? checkStatus(data.status ?? "unknown") : "pending",
      description: "Additional checks are available on Codeup.",
      url: null,
    });
  if (!data.latest && !results.length)
    results.push({
      name: "Codeup checks",
      status: "pending",
      description: "Waiting for the current patch set.",
      url: null,
    });
  return results;
}
export function activity(items: typeof Comments.Type, sourcePatch: string, targetPatch: string) {
  const comments: PullRequestComment[] = [];
  const reviewThreads: PullRequestReviewThread[] = [];
  const seen = new Set<string>();
  const convert = (c: typeof Comment.Type): PullRequestComment => ({
    id: c.comment_biz_id,
    kind: c.comment_type === "INLINE_COMMENT" ? "review-comment" : "issue-comment",
    author: actor(c.author),
    body: c.content,
    createdAt: c.comment_time,
    editedAt: c.last_edit_time ?? null,
    url: null,
    path: c.filePath ?? null,
    reviewState: null,
  });
  const isPublished = (c: typeof Comment.Type) => !c.is_deleted && c.state !== "DRAFT";
  for (const root of items) {
    if (root.state === "DRAFT") continue;
    const all = [root, ...(root.child_comments_list ?? [])].filter(isPublished);
    const resolution =
      isPublished(root) &&
      root.comment_type === "GLOBAL_COMMENT" &&
      typeof root.resolved === "boolean"
        ? {
            threadId: root.comment_biz_id,
            isResolved: root.resolved,
            isOutdated: root.out_dated === true,
          }
        : undefined;
    for (const c of all)
      if (!seen.has(c.comment_biz_id)) {
        comments.push({ ...convert(c), ...(resolution ? { resolution } : {}) });
        seen.add(c.comment_biz_id);
      }
    if (!isPublished(root) || root.comment_type !== "INLINE_COMMENT" || !root.filePath) continue;
    const located = root.location;
    const anchor = located?.located_patch_set_biz_id ?? root.related_patchset?.patchSetBizId;
    const side = anchor === targetPatch ? "left" : "right";
    reviewThreads.push({
      id: root.comment_biz_id,
      path: located?.located_file_path || root.filePath,
      line: (located?.located_line_number ?? root.line_number) || null,
      side,
      isResolved: root.resolved ?? false,
      isOutdated:
        root.out_dated === true ||
        located?.can_located === false ||
        (anchor !== sourcePatch && anchor !== targetPatch),
      comments: all.map(convert),
    });
  }
  return { comments, reviewThreads };
}

/** The live CI endpoint uses snake_case; published schemas also allow camelCase. */
export function normalizeChecks(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => normalizeChecks(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase()),
      normalizeChecks(item, depth + 1),
    ]),
  );
}
