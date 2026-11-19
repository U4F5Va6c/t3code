import { usePullRequestReviewDrafts, hasUnreviewedDraftHead } from "./usePullRequestReviewDrafts";
import { PendingReviewCommentCard } from "./PullRequestReviewAnnotation";
import { useAtomCommand } from "~/state/use-atom-command";
import type { EnvironmentId, PullRequestRef, PullRequestReviewVerdict } from "@t3tools/contracts";
import { CheckIcon, MessageSquareIcon, XCircleIcon } from "lucide-react";
import { msg, T, useGT, useMessages } from "gt-react";
import { useEffect, useState, type ReactNode, type RefObject } from "react";

import { m } from "~/i18n/messages";

import { TextFieldSpeechControls, useTextFieldSpeech } from "~/speech/useTextFieldSpeech";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { isCommentSubmitShortcut } from "../diffs/commentSubmitShortcut";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { toastManager } from "../ui/toast";
import { readableFailure } from "./pullRequestDetail.logic";
import { pullRequestReviewKey, usePullRequestReviewStore } from "./pullRequestReviewStore";
import {
  PullRequestMarkdownTextarea,
  type PullRequestCompletionScope,
} from "./PullRequestMarkdownTextarea";

import type { ChangeRequestTermKind } from "./changeRequestTerm";

const VERDICTS: ReadonlyArray<{
  readonly value: PullRequestReviewVerdict;
  readonly label: string;
  readonly sent: (term: ChangeRequestTermKind) => string;
  readonly icon: ReactNode;
}> = [
  {
    value: "comment",
    label: msg("Comment", { $context: "review verdict" }),
    sent: () => m(msg("Review submitted")),
    icon: <MessageSquareIcon className="size-3" />,
  },
  {
    value: "approve",
    label: msg("Approve", { $context: "review verdict" }),
    sent: (term) =>
      m(
        msg(
          "{term, select, mr {Merge request} cr {Change request} other {Pull request}} approved",
          { term },
        ),
      ),
    icon: <CheckIcon className="size-3" />,
  },
  {
    value: "request-changes",
    label: msg("Request changes"),
    sent: () => m(msg("Changes requested")),
    icon: <XCircleIcon className="size-3" />,
  },
];

export function PullRequestReviewForm({
  environmentId,
  active,
  reference,
  headSha,
  persistedDrafts = false,
  viewer,
  completionScope,
  term,
  verdicts,
  requestChangesSummaryRequired,
  textareaRef,
  pending,
  onPendingChange,
  onSubmitted,
}: {
  environmentId: EnvironmentId;
  /** False while the form stays mounted but hidden; dictation is cancelled then. */
  active: boolean;
  reference: PullRequestRef;
  headSha?: string | undefined;
  persistedDrafts?: boolean;
  viewer?: string | undefined;
  completionScope: PullRequestCompletionScope | null;
  term: ChangeRequestTermKind;
  verdicts: ReadonlyArray<PullRequestReviewVerdict>;
  requestChangesSummaryRequired: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onSubmitted: () => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
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
  const body = usePullRequestReviewStore((store) => store.summaries[reviewKey] ?? "");
  const removeComments = usePullRequestReviewStore((store) => store.removeComments);
  const setSummary = usePullRequestReviewStore((store) => store.setSummary);
  const speech = useTextFieldSpeech({
    environmentId,
    projectId: reference.projectId,
    ownerKey: JSON.stringify(["pr-review", environmentId, reviewKey]),
    text: body,
    textareaRef,
    onTextChange: (text) => setSummary(reviewKey, text),
    disabled: !active || pending,
  });
  const { cancel } = speech;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- discards a recording when the hidden form can no longer be submitted
  useEffect(() => {
    if (!active) cancel();
  }, [active, cancel]);
  const clearSummary = usePullRequestReviewStore((store) => store.clearSummary);
  const submitReview = useAtomCommand(pullRequestEnvironment.submitReview, {
    reportFailure: false,
  });

  const offered = VERDICTS.filter((verdict) => verdicts.includes(verdict.value));
  const selectedVerdict =
    offered.find((verdict) => verdict.value === requestedVerdict) ?? offered[0];

  const submit = async (verdict: (typeof VERDICTS)[number], text: string) => {
    const submittedComments = persistedDrafts
      ? comments
      : (usePullRequestReviewStore.getState().drafts[reviewKey] ?? []);
    if (
      pending ||
      (headChanged && verdict.value !== "comment") ||
      (persistedDrafts &&
        (headChanged || staleDrafts || !reviewDrafts.loaded || !reviewDrafts.canWrite)) ||
      !canSubmit(verdict.value, text, submittedComments.length)
    )
      return;
    const submittedBody = text;
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
      toastManager.add({
        type: "error",
        title: m(msg("The review could not be submitted")),
        description: readableFailure(
          squashAtomCommandFailure(result),
          m(msg("The host refused the review. Your draft is still here to try again.")),
        ),
      });
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
    toastManager.add({ type: "success", title: verdict.sent(term) });
    onSubmitted();
  };

  // Forgejo requires a summary when requesting changes, even with inline comments.
  const canSubmit = (verdict: PullRequestReviewVerdict, summary: string, commentCount: number) =>
    verdict === "request-changes" && requestChangesSummaryRequired
      ? summary.trim().length > 0
      : verdict === "approve" || summary.trim().length > 0 || commentCount > 0;
  const placeholder =
    selectedVerdict === undefined || canSubmit(selectedVerdict.value, "", comments.length)
      ? gt("Summarize your review (optional)")
      : selectedVerdict.value === "request-changes" && requestChangesSummaryRequired
        ? gt("Summarize your review (required to request changes)")
        : gt("Summarize your review or add line comments");

  return (
    <>
      {persistedDrafts ? (
        <div className="mb-2 max-h-60 space-y-2 overflow-y-auto">
          {!reviewDrafts.loaded ? (
            <p>
              <T>Loading private drafts…</T>
            </p>
          ) : null}
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
            <T>Refresh private drafts</T>
          </Button>
        </div>
      ) : null}
      {headChanged && (
        <div className="mb-2 space-y-2 text-xs text-muted-foreground">
          <p>
            <T>
              The branch changed. Review the latest diff before approving or requesting changes.
            </T>
          </p>
          <Button
            size="xs"
            variant="outline"
            disabled={pending || (persistedDrafts && headSha !== reviewDrafts.revision?.headSha)}
            onClick={() => setReviewedHeadSha(headSha)}
          >
            <T>I reviewed the latest changes</T>
          </Button>
        </div>
      )}
      <PullRequestMarkdownTextarea
        ref={textareaRef}
        completionScope={completionScope}
        rows={3}
        readOnly={speech.freezesEditor}
        value={body}
        placeholder={placeholder}
        aria-label={gt("Review summary")}
        onValueChange={(next) => setSummary(reviewKey, next)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat) return;
          if (
            selectedVerdict !== undefined &&
            isCommentSubmitShortcut(event, body, pending || speech.preparing, true)
          ) {
            event.preventDefault();
            event.stopPropagation();
            speech.submitAfterDictation((text) => void submit(selectedVerdict, text));
          }
        }}
      />
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        <TextFieldSpeechControls speech={speech} disabled={pending} />
        {offered.length > 1 ? (
          <Select
            value={selectedVerdict?.value ?? null}
            disabled={pending}
            onValueChange={(value) => {
              if (value !== null) setRequestedVerdict(value);
            }}
          >
            <SelectTrigger size="xs" className="w-auto min-w-0" aria-label={gt("Review verdict")}>
              <span className="flex items-center gap-1.5">
                {selectedVerdict?.icon}
                {selectedVerdict ? resolve(selectedVerdict.label) : null}
              </span>
            </SelectTrigger>
            <SelectPopup side="top" alignItemWithTrigger={false}>
              {offered.map((verdict) => (
                <SelectItem key={verdict.value} value={verdict.value}>
                  <span className="flex items-center gap-1.5">
                    {verdict.icon}
                    {resolve(verdict.label)}
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
        <Button
          size="xs"
          disabled={
            speech.preparing ||
            pending ||
            (persistedDrafts &&
              (headChanged || staleDrafts || !reviewDrafts.loaded || !reviewDrafts.canWrite)) ||
            selectedVerdict === undefined ||
            (!canSubmit(selectedVerdict.value, body, comments.length) &&
              !speech.blocksSubmission) ||
            (headChanged && selectedVerdict.value !== "comment")
          }
          onClick={() => {
            if (selectedVerdict !== undefined)
              speech.submitAfterDictation((text) => void submit(selectedVerdict, text));
          }}
        >
          {pending ? gt("Submitting...") : gt("Submit review")}
        </Button>
      </div>
    </>
  );
}
