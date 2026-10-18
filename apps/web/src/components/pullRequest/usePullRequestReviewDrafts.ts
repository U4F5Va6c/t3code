import type {
  EnvironmentId,
  PullRequestDraftList,
  PullRequestRef,
  PullRequestReviewCommentDraft,
  PullRequestReviewRevision,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";
import { create } from "zustand";
import { useEnvironmentPresentation } from "~/state/presentation";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";
import {
  nextPendingReviewCommentId,
  pullRequestReviewKey,
  usePendingReviewComments,
  usePullRequestReviewStore,
  type PendingReviewComment,
} from "./pullRequestReviewStore";

const usePlatformDrafts = create<{
  snapshots: Record<string, PullRequestDraftList>;
  set: (key: string, value: PullRequestDraftList) => void;
}>((set) => ({
  snapshots: {},
  set: (key, value) => set((state) => ({ snapshots: { ...state.snapshots, [key]: value } })),
}));
const generations = new Map<string, number>();

/** Keep unsuccessful deletions visible; only confirmed deletions are removed. */
export async function discardReviewDrafts(
  ids: ReadonlyArray<string>,
  remove: (id: string) => Promise<boolean>,
) {
  const removed: string[] = [];
  for (const id of ids) if (await remove(id)) removed.push(id);
  return removed;
}

export function privateReviewDraftKey(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
  viewer: string | undefined,
) {
  return JSON.stringify([
    environmentId,
    pullRequestReviewKey(reference),
    viewer ?? null,
    reference.expectedAccountId ?? null,
  ]);
}

export function hasUnreviewedDraftHead(
  reviewedHeadSha: string | undefined,
  headSha: string | undefined,
  revision: PullRequestReviewRevision | undefined,
) {
  return (
    reviewedHeadSha !== headSha || (revision !== undefined && revision.headSha !== reviewedHeadSha)
  );
}

export function usePullRequestReviewDrafts(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
  persisted: boolean,
  viewer: string | undefined,
  refreshToken?: unknown,
) {
  const { presentation } = useEnvironmentPresentation(environmentId);
  const connected = presentation?.connection.phase === "connected";
  const key = privateReviewDraftKey(environmentId, reference, viewer);
  const { projectId, host, repository, number, expectedAccountId } = reference;
  const stableRef = { projectId, host, repository, number, expectedAccountId };
  const local = usePendingReviewComments(reference);
  const snapshot = usePlatformDrafts((state) => state.snapshots[key]);
  const canWrite = useAtomValue(
    pullRequestEnvironment.createReviewDraft.permissionAtom(environmentId),
  );
  const list = useAtomCommand(pullRequestEnvironment.listReviewDrafts, { reportFailure: false });
  const createDraft = useAtomCommand(pullRequestEnvironment.createReviewDraft, {
    reportFailure: false,
  });
  const updateDraft = useAtomCommand(pullRequestEnvironment.updateReviewDraft, {
    reportFailure: false,
  });
  const deleteDraft = useAtomCommand(pullRequestEnvironment.deleteReviewDraft, {
    reportFailure: false,
  });
  const refresh = async () => {
    if (!persisted || !viewer || !connected) return;
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    const result = await list({ environmentId, input: stableRef });
    if (generations.get(key) !== generation) return;
    if (result._tag === "Success" && result.value.viewer === viewer)
      usePlatformDrafts.getState().set(key, result.value);
    else toastManager.add({ type: "error", title: "Could not refresh private review drafts" });
  };
  useEffect(() => {
    // The host refresh token deliberately invalidates a completed private read.
    void refreshToken;
    void refresh();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Host refreshes invalidate this read without changing its RPC input.
  }, [refresh, refreshToken]);
  const comments: ReadonlyArray<PendingReviewComment> = !persisted
    ? local
    : (snapshot?.drafts ?? []).map((d) => ({
        id: d.id,
        body: d.body,
        path: d.path ?? "Unknown location",
        ...(d.oldPath ? { oldPath: d.oldPath } : {}),
        position:
          d.side === "left"
            ? { kind: "deleted", oldLine: d.line ?? 1 }
            : { kind: "added", newLine: d.line ?? 1 },
        stale: d.stale,
        ...(d.revision ? { revision: d.revision } : {}),
        canEdit: d.canEdit,
        canDelete: d.canDelete,
      }));
  const add = async (
    comment: PullRequestReviewCommentDraft,
    revision?: PullRequestReviewRevision,
  ) => {
    if (!persisted) {
      usePullRequestReviewStore.getState().addComment(pullRequestReviewKey(stableRef), {
        ...comment,
        id: nextPendingReviewCommentId(),
      });
      return true;
    }
    if (!revision || !canWrite) return false;
    const result = await createDraft({
      environmentId,
      input: { ...stableRef, ...comment, expectedRevision: revision },
    });
    await refresh();
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Draft creation was not confirmed. Refresh before retrying.",
      });
      return false;
    }
    return true;
  };
  const remove = async (id: string) => {
    if (!persisted) {
      usePullRequestReviewStore.getState().removeComment(pullRequestReviewKey(stableRef), id);
      return true;
    }
    if (!canWrite) return false;
    const result = await deleteDraft({
      environmentId,
      input: { ...stableRef, draftCommentId: id },
    });
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Draft deletion was not confirmed. Refresh before retrying.",
      });
      return false;
    }
    generations.set(key, (generations.get(key) ?? 0) + 1);
    const current = usePlatformDrafts.getState().snapshots[key];
    if (current)
      usePlatformDrafts
        .getState()
        .set(key, { ...current, drafts: current.drafts.filter((d) => d.id !== id) });
    return true;
  };
  const update = async (id: string, body: string) => {
    if (!persisted || !canWrite) return false;
    const result = await updateDraft({
      environmentId,
      input: { ...stableRef, draftCommentId: id, body },
    });
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "Draft edit was not confirmed" });
      return false;
    }
    await refresh();
    return true;
  };
  return {
    comments,
    revision: snapshot?.revision,
    loaded: !persisted || snapshot !== undefined,
    canWrite: canWrite && (!persisted || !!viewer),
    add,
    remove,
    update,
    refresh,
    discard: () =>
      discardReviewDrafts(
        comments.map((d) => d.id),
        remove,
      ),
  };
}
