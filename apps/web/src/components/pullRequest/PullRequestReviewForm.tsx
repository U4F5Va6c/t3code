import { usePullRequestReviewDrafts, hasUnreviewedDraftHead } from "./usePullRequestReviewDrafts";
import { PendingReviewCommentCard } from "./PullRequestReviewAnnotation";
import { useAtomCommand } from "~/state/use-atom-command";
import type { EnvironmentId, PullRequestRef, PullRequestReviewVerdict } from "@t3tools/contracts";
import { CheckIcon, MessageSquareIcon, XCircleIcon } from "lucide-react";
import { useState, type ReactNode, type RefObject } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { pullRequestReviewKey, usePullRequestReviewStore } from "./pullRequestReviewStore";

const VERDICTS: ReadonlyArray<{
  readonly value: PullRequestReviewVerdict;
  readonly label: string;
  readonly sent: string;
  readonly icon: ReactNode;
}> = [
  {
    value: "comment",
    label: "Comment",
    sent: "Review submitted",
    icon: <MessageSquareIcon className="size-3" />,
  },
  {
    value: "approve",
    label: "Approve",
    sent: "Pull request approved",
    icon: <CheckIcon className="size-3" />,
  },
  {
    value: "request-changes",
    label: "Request changes",
    sent: "Changes requested",
    icon: <XCircleIcon className="size-3" />,
  },
];

export function PullRequestReviewForm({
  environmentId,
  reference,
  headSha,
  persistedDrafts = false,
  viewer,
  verdicts,
  requestChangesSummaryRequired,
  textareaRef,
  pending,
  onPendingChange,
  onSubmitted,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  headSha: string | undefined;
  persistedDrafts?: boolean;
  viewer?: string | undefined;
  verdicts: ReadonlyArray<PullRequestReviewVerdict>;
  requestChangesSummaryRequired: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onSubmitted: () => void;
}) {
  const [requestedVerdict, setRequestedVerdict] = useState<PullRequestReviewVerdict>("comment");
  const [reviewedHeadSha, setReviewedHeadSha] = useState(headSha);
  const reviewDrafts = usePullRequestReviewDrafts(
    environmentId,
    reference,
    persistedDrafts,
    viewer,
    headSha,
  );
  const headChanged = hasUnreviewedDraftHead(
    reviewedHeadSha,
    headSha,
    persistedDrafts ? reviewDrafts.revision : undefined,
  );
  const comments = reviewDrafts.comments;
  const staleDrafts = comments.some((comment) => comment.stale);
  const reviewKey = pullRequestReviewKey(reference);
  // The panel stays mounted while the selected pull request changes. Keeping summaries beside
  // the keyed line-comment drafts makes the selected pull request's body correct on the first
  // render, before an effect could reset state left behind by the previous one.
  const body = usePullRequestReviewStore((store) => store.summaries[reviewKey] ?? "");
  const removeComments = usePullRequestReviewStore((store) => store.removeComments);
  const setSummary = usePullRequestReviewStore((store) => store.setSummary);
  const clearSummary = usePullRequestReviewStore((store) => store.clearSummary);
  const submitReview = useAtomCommand(pullRequestEnvironment.submitReview, {
    reportFailure: false,
  });

  const offered = VERDICTS.filter((verdict) => verdicts.includes(verdict.value));
  const selectedVerdict =
    offered.find((verdict) => verdict.value === requestedVerdict) ?? offered[0];

  const submit = async (verdict: (typeof VERDICTS)[number]) => {
    if (
      pending ||
      (headChanged && verdict.value !== "comment") ||
      (persistedDrafts &&
        (headChanged || staleDrafts || !reviewDrafts.loaded || !reviewDrafts.canWrite))
    )
      return;
    const submittedBody = body;
    const submittedComments = comments;
    onPendingChange(true);
    const result = await submitReview({
      environmentId,
      input: {
        ...reference,
        ...(reviewedHeadSha ? { expectedHeadSha: reviewedHeadSha } : {}),
        verdict: verdict.value,
        body: submittedBody,
        comments: persistedDrafts ? [] : submittedComments,
        ...(persistedDrafts && submittedComments.length > 0 && reviewDrafts.revision
          ? {
              draftCommentIds: submittedComments.map((c) => c.id),
              expectedRevision: reviewDrafts.revision,
            }
          : {}),
      },
    });
    onPendingChange(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: "The review could not be submitted" });
      return;
    }
    // More remarks may have been added while the host was accepting this snapshot. Leave those,
    // and any summary revised in the meantime, ready for the next review.
    if (persistedDrafts) await reviewDrafts.refresh();
    else
      removeComments(
        reviewKey,
        submittedComments.map((comment) => comment.id),
      );
    clearSummary(reviewKey, submittedBody);
    toastManager.add({ type: "success", title: verdict.sent });
    onSubmitted();
  };

  // Forgejo requires a summary when requesting changes, even with inline comments.
  const canSubmit = (verdict: PullRequestReviewVerdict, summary: string) =>
    verdict === "request-changes" && requestChangesSummaryRequired
      ? summary.trim().length > 0
      : verdict === "approve" || summary.trim().length > 0 || comments.length > 0;
  const placeholder =
    selectedVerdict === undefined || canSubmit(selectedVerdict.value, "")
      ? "Summarize your review (optional)"
      : selectedVerdict.value === "request-changes" && requestChangesSummaryRequired
        ? "Summarize your review (required to request changes)"
        : "Summarize your review or add line comments";

  return (
    <>
      {persistedDrafts ? (
        <div className="mb-2 max-h-60 space-y-2 overflow-y-auto">
          {!reviewDrafts.loaded ? <p>Loading private drafts…</p> : null}
          {comments.map((comment) => (
            <div key={comment.id}>
              <p className="text-xs text-muted-foreground">{comment.path}</p>
              <PendingReviewCommentCard
                comment={{
                  ...comment,
                  canEdit: comment.canEdit !== false && reviewDrafts.canWrite,
                  canDelete: comment.canDelete !== false && reviewDrafts.canWrite,
                }}
                onRemove={() => {
                  void reviewDrafts.remove(comment.id);
                }}
                onEdit={(body) => reviewDrafts.update(comment.id, body)}
              />
            </div>
          ))}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              void reviewDrafts.refresh();
            }}
          >
            Refresh private drafts
          </Button>
        </div>
      ) : null}
      {headChanged && (
        <div className="mb-2 space-y-2 text-xs text-muted-foreground">
          <p>The branch changed. Review the latest diff before approving or requesting changes.</p>
          <Button
            size="xs"
            variant="outline"
            disabled={pending || (persistedDrafts && headSha !== reviewDrafts.revision?.headSha)}
            onClick={() => setReviewedHeadSha(headSha)}
          >
            I reviewed the latest changes
          </Button>
        </div>
      )}
      <Textarea
        ref={textareaRef}
        rows={3}
        value={body}
        placeholder={placeholder}
        aria-label="Review summary"
        onChange={(event) => setSummary(reviewKey, event.target.value)}
      />
      <div className="mt-2 flex justify-end gap-2">
        {offered.length > 1 ? (
          <Select
            value={selectedVerdict?.value ?? null}
            disabled={pending}
            onValueChange={(value) => {
              if (value !== null) setRequestedVerdict(value);
            }}
          >
            <SelectTrigger size="xs" className="mr-auto w-auto min-w-0" aria-label="Review verdict">
              <span className="flex items-center gap-1.5">
                {selectedVerdict?.icon}
                {selectedVerdict?.label}
              </span>
            </SelectTrigger>
            <SelectPopup side="top" alignItemWithTrigger={false}>
              {offered.map((verdict) => (
                <SelectItem key={verdict.value} value={verdict.value}>
                  <span className="flex items-center gap-1.5">
                    {verdict.icon}
                    {verdict.label}
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        <Button
          size="xs"
          disabled={
            pending ||
            (persistedDrafts &&
              (headChanged || staleDrafts || !reviewDrafts.loaded || !reviewDrafts.canWrite)) ||
            selectedVerdict === undefined ||
            !canSubmit(selectedVerdict.value, body) ||
            (headChanged && selectedVerdict.value !== "comment")
          }
          onClick={() => {
            if (selectedVerdict !== undefined) void submit(selectedVerdict);
          }}
        >
          {pending ? "Submitting..." : "Submit review"}
        </Button>
      </div>
    </>
  );
}
