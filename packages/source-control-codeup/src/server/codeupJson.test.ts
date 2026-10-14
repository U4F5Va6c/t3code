import { PullRequestComment } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { activity, Comments, MergeRequest, summary } from "./codeupJson.ts";

const root = {
  comment_biz_id: "root",
  content: "Please check the behavior",
  author: null,
  comment_time: "2026-10-12T00:00:00Z",
  comment_type: "GLOBAL_COMMENT",
  state: "OPENED",
  resolved: false,
};
const decodeComments = Schema.decodeUnknownSync(Comments);
const decodeComment = Schema.decodeUnknownSync(PullRequestComment);
const read = (rows: unknown) => activity(decodeComments(rows), "source", "base");

describe("Codeup conversation states", () => {
  it.each([false, true])(
    "keeps a published global conversation resolved=%s off the diff",
    (resolved) => {
      const result = read([{ ...root, resolved }]);
      expect(result.reviewThreads).toEqual([]);
      const comment = decodeComment(result.comments[0]);
      expect(comment.path).toBeNull();
      expect(comment.resolution).toEqual({
        threadId: "root",
        isResolved: resolved,
        isOutdated: false,
      });
      expect(comment.reviewState).toBeNull();
    },
  );

  it("uses the root's state and identity for replies without conflating outdated with resolved", () => {
    const result = read([
      {
        ...root,
        resolved: true,
        out_dated: true,
        child_comments_list: [{ ...root, comment_biz_id: "reply", resolved: false }],
      },
    ]);
    expect(result.comments.map((comment) => comment.resolution)).toEqual([
      { threadId: "root", isResolved: true, isOutdated: true },
      { threadId: "root", isResolved: true, isOutdated: true },
    ]);
    expect(read([{ ...root, out_dated: true }]).comments[0]?.resolution?.isResolved).toBe(false);
  });

  it("does not invent a resolution state when Codeup omits it or reports another comment kind", () => {
    const { resolved: _resolved, ...withoutState } = root;
    expect(read([withoutState]).comments[0]?.resolution).toBeUndefined();
    expect(
      read([{ ...root, comment_type: "SYSTEM_COMMENT" }]).comments[0]?.resolution,
    ).toBeUndefined();
  });

  it("omits drafts and deleted remarks while retaining visible replies to a deleted root", () => {
    const result = read([
      {
        ...root,
        state: "DRAFT",
        child_comments_list: [{ ...root, comment_biz_id: "draft-reply" }],
      },
      {
        ...root,
        comment_biz_id: "deleted",
        is_deleted: true,
        child_comments_list: [
          { ...root, comment_biz_id: "visible-reply" },
          { ...root, comment_biz_id: "removed-reply", is_deleted: true },
          { ...root, comment_biz_id: "unpublished-reply", state: "DRAFT" },
        ],
      },
    ]);
    expect(result.comments.map((comment) => comment.id)).toEqual(["visible-reply"]);
    expect(result.comments[0]?.resolution).toBeUndefined();
    expect(result.reviewThreads).toEqual([]);
  });

  it("keeps line conversations anchored and resolvable through the existing review thread", () => {
    const result = read([
      {
        ...root,
        comment_type: "INLINE_COMMENT",
        filePath: "src/app.ts",
        line_number: 3,
        related_patchset: { patchSetBizId: "source" },
      },
    ]);
    expect(result.comments[0]?.resolution).toBeUndefined();
    expect(result.reviewThreads[0]).toMatchObject({
      id: "root",
      path: "src/app.ts",
      line: 3,
      isResolved: false,
      isOutdated: false,
    });
  });
});

const decodeMergeRequest = Schema.decodeSync(MergeRequest);

it("preserves Codeup native IDs and the platform's full detail URL", () => {
  const value = decodeMergeRequest({
    localId: 7,
    bizId: "biz-7",
    targetProjectId: 12,
    sourceProjectId: 34,
    title: "Feature",
    sourceBranch: "feature",
    targetBranch: "main",
    author: null,
    reviewers: [],
    status: "UNDER_REVIEW",
    createTime: "2026-10-12T00:00:00Z",
    updateTime: "2026-10-12T00:00:00Z",
    detailUrl: "https://codeup.aliyun.com/org/team/repo/change/7",
  });
  expect(summary("org/team/repo", value)).toMatchObject({
    nativeIdentity: {
      repositoryId: 12,
      localId: 7,
      bizId: "biz-7",
      sourceRepositoryId: 34,
      targetRepositoryId: 12,
    },
    url: value.detailUrl,
  });
});
