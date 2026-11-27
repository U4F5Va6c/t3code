import type { PullRequestCheck, PullRequestChecks, PullRequestDetail } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export function pendingPullRequestCheckLabel(
  check: Pick<PullRequestCheck, "pendingReason">,
  resolve: MFunctionType = mFallback,
) {
  switch (check.pendingReason) {
    case "not-run":
      return resolve(msg("Not run"));
    case "queued":
      return resolve(msg("Queued"));
    case "unknown":
      return resolve(msg("Pending", { $context: "CI check status" }));
    default:
      return resolve(msg("Running", { $context: "CI check status" }));
  }
}

export function summarizePendingPullRequestChecks(
  checks: ReadonlyArray<PullRequestCheck>,
  resolve: MFunctionType = mFallback,
) {
  const counts = new Map<NonNullable<PullRequestCheck["pendingReason"]> | "running", number>();
  for (const check of checks) {
    if (check.status !== "pending") continue;
    const reason = check.pendingReason ?? "running";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const total = checks.length;
  return Array.from(counts, ([reason, count]) => {
    switch (reason) {
      case "not-run":
        return resolve(msg("{count} of {total} not run", { count, total }));
      case "queued":
        return resolve(msg("{count} of {total} queued", { count, total }));
      case "unknown":
        return resolve(msg("{count} of {total} pending", { count, total }));
      case "running":
        return resolve(msg("{pending} of {total} running", { pending: count, total }));
    }
  }).join(" · ");
}

export function resolvePullRequestDetailChecks(
  detail: PullRequestDetail | null,
  checks: PullRequestChecks | null,
  checksAreNewer: boolean,
): PullRequestDetail | null {
  if (detail === null || checks === null) return detail;
  const newer =
    detail.observedAt !== undefined && checks.observedAt !== undefined
      ? checks.observedAt >= detail.observedAt
      : checksAreNewer;
  if (!newer) return detail;
  // Older servers omit the count. Their check rows can still confirm that nothing needs approval.
  const workflowApprovalsRequired =
    checks.workflowApprovalsRequired ??
    (detail.workflowApprovalsRequired !== undefined &&
    !checks.checks.some((check) => check.status === "action-required")
      ? 0
      : detail.workflowApprovalsRequired);
  return {
    ...detail,
    state: detail.state === "merged" ? "merged" : checks.state,
    checks: checks.checks,
    ...(workflowApprovalsRequired === undefined ? {} : { workflowApprovalsRequired }),
  };
}

/** Checks still running are worth a tighter poll than a settled head. */
export function pullRequestChecksRefreshIntervalMs(
  checks: ReadonlyArray<PullRequestCheck>,
): number {
  return checks.length === 0 ||
    checks.some((check) => check.status === "pending" || check.status === "action-required")
    ? 45_000
    : 60_000;
}
