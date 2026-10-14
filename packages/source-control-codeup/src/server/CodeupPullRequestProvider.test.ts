import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import * as TestHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Api from "./CodeupApi.ts";
import * as Provider from "./CodeupPullRequestProvider.ts";
import * as Json from "./codeupJson.ts";

const input = { cwd: "/repo", host: "codeup.aliyun.com", repository: "org/team/repo", number: 7 };
const user = { userId: "user-1", name: "Reviewer", username: "reviewer", avatar: null };
const mr = {
  localId: 7,
  bizId: "mr-biz-7",
  detailUrl: "https://codeup.aliyun.com/org/team/repo/change/7",
  title: "Add Codeup",
  sourceBranch: "feature",
  targetBranch: "main",
  sourceProjectId: 12,
  targetProjectId: 12,
  author: user,
  reviewers: [],
  status: "UNDER_REVIEW",
  createTime: "2026-10-12T00:00:00Z",
  updateTime: "2026-10-12T01:00:00Z",
  conflictCheckStatus: "NO_CONFLICT",
  allRequirementsPass: true,
  description: "Preview me",
  totalCommentCount: 0,
};
const patchSets = [
  { commitId: "old", patchSetBizId: "s1", relatedMergeItemType: "MERGE_SOURCE", versionNo: 1 },
  { commitId: "head", patchSetBizId: "s2", relatedMergeItemType: "MERGE_SOURCE", versionNo: 2 },
  { commitId: "base", patchSetBizId: "b1", relatedMergeItemType: "MERGE_TARGET", versionNo: 1 },
];
const compare = {
  commits: [],
  diffs: [
    {
      oldPath: "new.ts",
      newPath: "new.ts",
      newFile: true,
      oldId: "0000000",
      newId: "abc1234",
      diff: "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+hello\n",
    },
  ],
};
function harness(
  options: {
    gate?: boolean;
    changedAfterWrite?: boolean;
    changedBeforeComment?: boolean;
    afterChecks?: Partial<typeof mr>;
    changedPatch?: "MERGE_SOURCE" | "MERGE_TARGET";
    access?: number;
    checks?: unknown;
    failWrite?: boolean;
    acceptedBeforeTimeout?: boolean;
    comments?: typeof Json.Comments.Type;
    members?: typeof Json.Members.Type;
  } = {},
) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  let patchReads = 0;
  let checksRead = false;
  let status = mr.status;
  let title = mr.title;
  let description = mr.description;
  let comments = options.comments ?? [];
  const http = HttpClient.make((request) => {
    const url = new URL(request.url);
    const repository =
      request.headers["x-yunxiao-token"] === "other-token" ? "other/team/repo" : input.repository;
    requests.push({
      method: request.method,
      url: request.url,
      body:
        request.body._tag === "Uint8Array"
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : null,
    });
    let data: unknown;
    if (url.pathname.endsWith("/members")) data = options.members ?? [];
    else if (url.pathname.endsWith("/comments/list")) data = comments;
    else if (request.method !== "GET") {
      if (options.failWrite && !options.acceptedBeforeTimeout)
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response("{}", { status: 503 })),
        );
      if (url.pathname.endsWith("/merge")) status = "MERGED";
      if (url.pathname.endsWith("/close")) status = "CLOSED";
      if (url.pathname.endsWith("/reopen")) status = "UNDER_REVIEW";
      if (request.method === "PUT" && url.pathname.includes("/comments/")) {
        const body = requests.at(-1)?.body as { resolved: boolean };
        comments = comments.map((comment) =>
          url.pathname.endsWith(`/comments/${comment.comment_biz_id}`)
            ? { ...comment, resolved: body.resolved }
            : comment,
        );
      }
      if (request.method === "PUT" && url.pathname.endsWith("/changeRequests/7")) {
        const body = requests.at(-1)?.body as { title?: string; description?: string };
        title = body.title ?? title;
        description = body.description ?? description;
      }
      if (options.acceptedBeforeTimeout)
        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response("{}", { status: 503 })),
        );
      data = { result: true };
    } else if (url.pathname.endsWith("/diffs/patches")) {
      patchReads++;
      data = patchSets.map((patch) =>
        (options.changedBeforeComment &&
          patchReads > 1 &&
          patch.relatedMergeItemType === "MERGE_SOURCE") ||
        (checksRead && patch.relatedMergeItemType === options.changedPatch) ||
        (options.changedAfterWrite &&
          requests.some((r) => r.method === "POST") &&
          patch.relatedMergeItemType === "MERGE_SOURCE")
          ? { ...patch, commitId: "changed" }
          : patch,
      );
    } else if (url.pathname.endsWith("/compares")) data = compare;
    else if (url.pathname.endsWith("/ciCheckList")) {
      checksRead = true;
      data = options.checks ?? {
        latest: true,
        item_count: 1,
        check_list: [{ task_name: "Build", state: "PASS", required: true, invalid: false }],
        commit_statuses: [],
      };
    } else if (url.pathname === "/oapi/v1/platform/user")
      data = {
        id:
          request.headers["x-yunxiao-token"] === "other-token"
            ? "other-viewer"
            : "organization-viewer",
      };
    else if (url.pathname.endsWith("/changeRequests/7"))
      data = {
        ...mr,
        detailUrl: `https://${input.host}/${repository}/change/7`,
        title,
        description,
        status,
        allRequirementsPass: options.gate ?? true,
        ...(checksRead ? options.afterChecks : {}),
      };
    else if (url.pathname.endsWith("/changeRequests")) {
      const page = Number(url.searchParams.get("page"));
      data = Array.from({ length: page === 1 ? 100 : 4 }, (_, i) => ({
        ...mr,
        localId: (page - 1) * 100 + i + 1,
        state: "UNDER_REVIEW",
        createdAt: mr.createTime,
        updatedAt: mr.updateTime,
      }));
    } else
      data = {
        id: 12,
        pathWithNamespace: repository,
        webUrl: `https://${input.host}/${repository}`,
        sshUrlToRepo: `git@${input.host}:${repository}.git`,
        httpUrlToRepo: `https://${input.host}/${repository}.git`,
        accessLevel: String(options.access ?? 40),
      };
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(data)));
  });
  const layer = Api.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provide(
      TestHost.layer({
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          sourceControlHosts: {
            codeup: { organizationTokens: { org: "test-token", other: "other-token" } },
          },
        },
      }),
    ),
  );
  return { requests, layer: layer.pipe(Layer.provideMerge(TestHost.layer())) };
}

describe("Codeup MR integration", () => {
  it.effect("resolves and reopens a general conversation with fresh root and reply states", () => {
    const root = {
      comment_biz_id: "global-root",
      content: "Check this",
      author: user,
      comment_time: mr.createTime,
      comment_type: "GLOBAL_COMMENT",
      resolved: false,
    };
    const { layer, requests } = harness({
      comments: [{ ...root, child_comments_list: [{ ...root, comment_biz_id: "reply" }] }],
    });
    return Effect.gen(function* () {
      const p = yield* Provider.make;
      for (const resolved of [true, false]) {
        yield* p.setThreadResolution({ ...input, threadId: "global-root", resolved });
        const activity = yield* p.getChangeRequestActivity(input);
        expect(activity.comments.map((comment) => comment.resolution)).toEqual([
          { threadId: "global-root", isResolved: resolved, isOutdated: false },
          { threadId: "global-root", isResolved: resolved, isOutdated: false },
        ]);
        expect(activity.comments.map((comment) => comment.body)).toEqual([
          "Check this",
          "Check this",
        ]);
        expect(activity.reviewThreads).toEqual([]);
      }
      expect(
        requests.filter((request) => request.method === "PUT").map((request) => request.body),
      ).toEqual([{ resolved: true }, { resolved: false }]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not retry an uncertain resolution write", () => {
    const { layer, requests } = harness({ failWrite: true });
    return Effect.gen(function* () {
      const p = yield* Provider.make;
      yield* p
        .setThreadResolution({ ...input, threadId: "global-root", resolved: true })
        .pipe(Effect.flip);
      expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });
  it.effect("scopes list filtering to the repository ID and its organization's viewer", () => {
    const { layer, requests } = harness();
    return Effect.gen(function* () {
      const p = yield* Provider.make;
      const listed = yield* p.listChangeRequests({
        ...input,
        state: "open",
        involvement: "authored",
        viewer: "another-organization-user",
        limit: 1,
      });
      const url = new URL(requests.find((r) => r.url.includes("/changeRequests?"))!.url);
      expect(url.searchParams.get("projectIds")).toBe("12");
      expect(url.searchParams.get("authorIds")).toBe("organization-viewer");
      expect(listed.items[0]?.viewer).toBe("organization-viewer");
      const other = yield* p.listChangeRequests({
        ...input,
        repository: "other/team/repo",
        state: "open",
        involvement: "all",
        viewer: "organization-viewer",
        limit: 1,
      });
      expect(other.items[0]?.viewer).toBe("other-viewer");
    }).pipe(Effect.provide(layer));
  });
  it.effect(
    "rejects a review of an older head without writing, and refuses an unrelated commit diff",
    () => {
      const { layer, requests } = harness();
      return Effect.gen(function* () {
        const p = yield* Provider.make;
        expect(
          (yield* p
            .submitReview({
              ...input,
              verdict: "approve",
              body: "",
              comments: [],
              expectedHeadSha: "old",
            })
            .pipe(Effect.flip)).detail,
        ).toContain("changed");
        expect(
          (yield* p.getDiff({ ...input, commit: "unrelated" }).pipe(Effect.flip)).detail,
        ).toContain("no longer part");
        expect(requests.every((r) => r.method === "GET")).toBe(true);
        yield* p.submitReview({
          ...input,
          verdict: "approve",
          body: "",
          comments: [],
          expectedHeadSha: "head",
        });
        expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
      }).pipe(Effect.provide(layer));
    },
  );
  it("maps actual review verdicts, including reviews without text", () => {
    expect(
      Json.reviewActivity([
        {
          ...user,
          hasReviewed: true,
          reviewOpinionStatus: "PASS",
          reviewTime: "2026-10-12T00:00:00Z",
        },
      ])[0],
    ).toMatchObject({ kind: "review", reviewState: "APPROVED", body: "" });
    expect(
      Json.reviewActivity([{ ...user, hasReviewed: false, reviewOpinionStatus: "PASS" }]),
    ).toEqual([]);
  });
  it.effect("reads a cheap hover preview, then the current diff, check and details", () => {
    const { layer, requests } = harness();
    return Effect.gen(function* () {
      const p = yield* Provider.make;
      expect((yield* p.getChangeRequestPreview(input)).title).toBe(mr.title);
      expect(requests).toHaveLength(1);
      const detail = yield* p.getChangeRequest(input);
      expect(detail.headSha).toBe("head");
      expect(detail.viewer).toBe("organization-viewer");
      expect(detail.additions).toBe(1);
      expect(detail.changedFiles).toBe(1);
      expect(detail.checks[0]).toMatchObject({ name: "Build", status: "success", required: true });
      expect(requests.find((r) => r.url.includes("/compares"))?.url).toContain(
        "from=base&to=head&straight=false",
      );
      expect(requests.find((r) => r.url.includes("/ciCheckList"))?.url).toContain(
        "patchSetBizId=s2",
      );
      const diff = yield* p.getDiff(input);
      expect(diff.patch).toContain("new file mode 100644");
      expect(diff.patch.match(/--- \/dev\/null/gu)).toHaveLength(1);
      expect(diff.truncated).toBe(false);
    }).pipe(Effect.provide(layer));
  });
  it.effect(
    "continues across fixed host pages without losing rows when the slice size changes",
    () => {
      const { layer } = harness();
      return Effect.gen(function* () {
        const p = yield* Provider.make;
        const page = yield* p.listChangeRequests({
          ...input,
          state: "all",
          involvement: "all",
          viewer: "user-1",
          limit: 6,
          cursor: { delivered: 98, updatedBefore: mr.updateTime },
        });
        expect(page.items.map((i) => i.number)).toEqual([99, 100, 101, 102, 103, 104]);
        expect(page.truncated).toBe(false);
        expect(page.cursorAdvance).toBe(6);
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect("never reports stale or unknown checks as passing", () => {
    const { layer } = harness({
      checks: {
        latest: true,
        itemCount: 2,
        checkList: [{ taskName: "Unknown", state: "FUTURE" }],
        commitStatuses: [{ context: "Old build", state: "success", sha: "old" }],
      },
    });
    return Effect.gen(function* () {
      const p = yield* Provider.make;
      expect((yield* p.getChangeRequestChecks(input)).checks.map((c) => c.status)).toEqual([
        "pending",
        "pending",
      ]);
    }).pipe(Effect.provide(layer));
  });
  it.effect("honors repository read-only access and Codeup merge gates", () => {
    const { layer, requests } = harness({ gate: false, access: 20 });
    return Effect.gen(function* () {
      const p = yield* Provider.make;
      expect((yield* p.getViewerPermissions(input)).actions).toEqual([]);
      expect(
        (yield* p.runAction({ ...input, action: "merge" }).pipe(Effect.flip)).detail,
      ).toContain("requirements");
      expect(requests.every((r) => r.method === "GET")).toBe(true);
    }).pipe(Effect.provide(layer));
  });
  it.effect("sends a native merge without bypass flags and confirms the resulting state", () => {
    const { layer, requests } = harness();
    return Effect.gen(function* () {
      const p = yield* Provider.make;
      yield* p.runAction({ ...input, action: "merge", mergeMethod: "squash" });
      expect(requests.find((r) => r.method === "POST")?.body).toEqual({
        mergeType: "squash",
        removeSourceBranch: false,
      });
      expect((yield* p.getChangeRequestSummary(input)).state).toBe("merged");
    }).pipe(Effect.provide(layer));
  });
  it.effect("does not retry an uncertain write", () => {
    const { layer, requests } = harness({ failWrite: true });
    return Effect.gen(function* () {
      const p = yield* Provider.make;
      yield* p.comment({ ...input, body: "Check me" }).pipe(Effect.flip);
      expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });
  it("keeps renamed/binary files visible and marks unknown anchors outdated", () => {
    const diff = Json.patch({
      commits: [],
      diffs: [
        {
          oldPath: "old.ts",
          newPath: "new.ts",
          renamedFile: true,
          oldId: "same",
          newId: "same",
          diff: "",
        },
        { oldPath: "image.png", newPath: "image.png", isBinary: true, diff: "" },
      ],
    });
    expect(diff.patch).toContain("rename from old.ts");
    expect(diff.patch).toContain("Binary files");
    const result = Json.activity(
      [
        {
          comment_biz_id: "c1",
          content: "Old remark",
          author: user,
          comment_time: mr.createTime,
          comment_type: "INLINE_COMMENT",
          filePath: "new.ts",
          line_number: 1,
          related_patchset: { patchSetBizId: "s1" },
        },
      ],
      "s2",
      "b1",
    );
    expect(result.reviewThreads[0]?.isOutdated).toBe(true);
  });
});

it.effect.each([false, true])(
  "confirms state and edits after uncertain writes (accepted=%s)",
  (acceptedBeforeTimeout) => {
    const { layer, requests } = harness({ failWrite: true, acceptedBeforeTimeout });
    return Effect.gen(function* () {
      const provider = yield* Provider.make;
      for (const operation of [
        provider.runAction({ ...input, action: "close" }),
        provider.runAction({ ...input, action: "reopen" }),
        provider.updateChangeRequest({ ...input, title: "Updated", body: "New description" }),
      ]) {
        const result = yield* operation.pipe(Effect.result);
        // Reopening an already-open MR is a successful no-op.
        if (acceptedBeforeTimeout) expect(result._tag).toBe("Success");
      }
      const before = requests.filter((r) => r.method !== "GET").length;
      if (acceptedBeforeTimeout) {
        yield* provider.updateChangeRequest({
          ...input,
          title: "Updated",
          body: "New description",
        });
        expect(requests.filter((r) => r.method !== "GET")).toHaveLength(before);
      } else {
        expect(
          (yield* provider.updateChangeRequest({ ...input, title: "Updated" }).pipe(Effect.result))
            ._tag,
        ).toBe("Failure");
      }
    }).pipe(Effect.provide(layer));
  },
);

it.effect.each([
  { targetBranch: "changed" },
  { sourceBranch: "changed" },
  { sourceProjectId: 99 },
  { targetProjectId: 99 },
  { allRequirementsPass: false },
  { conflictCheckStatus: "CHECKING" },
])("rejects changed merge identity or gates after checking: %j", (afterChecks) => {
  const { layer, requests } = harness({ afterChecks });
  return Effect.gen(function* () {
    const provider = yield* Provider.make;
    yield* provider
      .runAction({ ...input, action: "merge", expectedHeadSha: "head" })
      .pipe(Effect.flip);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  }).pipe(Effect.provide(layer));
});
it.effect.each(["MERGE_SOURCE", "MERGE_TARGET"] as const)(
  "rejects changed %s during merge checks",
  (changedPatch) => {
    const { layer, requests } = harness({ changedPatch });
    return Effect.gen(function* () {
      const provider = yield* Provider.make;
      yield* provider
        .runAction({ ...input, action: "merge", expectedHeadSha: "head" })
        .pipe(Effect.flip);
      expect(requests.every((request) => request.method === "GET")).toBe(true);
    }).pipe(Effect.provide(layer));
  },
);
it.effect("rejects stale merge and missing or stale comment-review heads without writing", () => {
  const { layer, requests } = harness();
  return Effect.gen(function* () {
    const provider = yield* Provider.make;
    yield* provider
      .runAction({ ...input, action: "merge", expectedHeadSha: "old" })
      .pipe(Effect.flip);
    for (const body of ["", "Review comment"])
      for (const expectedHeadSha of [undefined, "old"])
        yield* provider
          .submitReview({
            ...input,
            verdict: "comment",
            body,
            comments: [],
            ...(expectedHeadSha === undefined ? {} : { expectedHeadSha }),
          })
          .pipe(Effect.flip);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    yield* provider.submitReview({
      ...input,
      verdict: "comment",
      body: "Review comment",
      comments: [],
      expectedHeadSha: "head",
    });
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  }).pipe(Effect.provide(layer));
});
it.effect("does not repeat uncertain merge or review writes", () => {
  const { layer, requests } = harness({ failWrite: true, acceptedBeforeTimeout: true });
  return Effect.gen(function* () {
    const provider = yield* Provider.make;
    yield* provider
      .runAction({ ...input, action: "merge", expectedHeadSha: "head" })
      .pipe(Effect.flip);
    yield* provider
      .submitReview({
        ...input,
        verdict: "approve",
        body: "",
        comments: [],
        expectedHeadSha: "head",
      })
      .pipe(Effect.flip);
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(2);
  }).pipe(Effect.provide(layer));
});

it.effect("reports a changed head after a comment review without repeating the comment", () => {
  const { layer, requests } = harness({ changedAfterWrite: true });
  return Effect.gen(function* () {
    const provider = yield* Provider.make;
    const error = yield* provider
      .submitReview({
        ...input,
        verdict: "comment",
        body: "Reviewed",
        comments: [],
        expectedHeadSha: "head",
      })
      .pipe(Effect.flip);
    expect(error.detail).toContain("accepted the review while the head changed");
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  }).pipe(Effect.provide(layer));
});

it.effect(
  "refuses a comment review if its patch changed between preflight and comment creation",
  () => {
    const { layer, requests } = harness({ changedBeforeComment: true });
    return Effect.gen(function* () {
      const provider = yield* Provider.make;
      const error = yield* provider
        .submitReview({
          ...input,
          verdict: "comment",
          body: "Reviewed",
          comments: [],
          expectedHeadSha: "head",
        })
        .pipe(Effect.flip);
      expect(error.detail).toContain("before the comment was posted");
      expect(requests.every((request) => request.method === "GET")).toBe(true);
    }).pipe(Effect.provide(layer));
  },
);

it.effect("reads all reviewer candidates from the non-paginated members endpoint", () => {
  const members = Array.from({ length: 105 }, (_, index) => ({
    userId: `member-${index}`,
    username: `member-${index}`,
    name: `Member ${index}`,
    avatarUrl: null,
    state: "active",
  }));
  const { layer, requests } = harness({
    members: [
      ...members,
      { ...members[0]!, userId: user.userId },
      { ...members[0]!, userId: "blocked-member", state: "blocked" },
    ],
  });
  return Effect.gen(function* () {
    const provider = yield* Provider.make;
    const result = yield* provider.listReviewerCandidates(input);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(
      members.map((member) => member.userId),
    );
    expect(result.truncated).toBe(false);
    const memberRequests = requests.filter((request) =>
      new URL(request.url).pathname.endsWith("/members"),
    );
    expect(memberRequests).toHaveLength(1);
    expect(new URL(memberRequests[0]!.url).search).toBe("");
    expect(memberRequests[0]!.method).toBe("GET");
  }).pipe(Effect.provide(layer));
});
