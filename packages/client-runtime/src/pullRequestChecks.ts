import type { PullRequestCheck, PullRequestChecks, PullRequestDetail } from "@t3tools/contracts";

export function pendingPullRequestCheckLabel(check: Pick<PullRequestCheck, "pendingReason">) {
  switch (check.pendingReason) {
    case "not-run":
      return "Not run";
    case "queued":
      return "Queued";
    case "unknown":
      return "Pending";
    default:
      return "Running";
  }
}

export function summarizePendingPullRequestChecks(checks: ReadonlyArray<PullRequestCheck>) {
  const counts = new Map<string, number>();
  for (const check of checks) {
    if (check.status !== "pending") continue;
    const label = pendingPullRequestCheckLabel(check).toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => `${count} of ${checks.length} ${label}`).join(" · ");
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
  return newer
    ? {
        ...detail,
        state: detail.state === "merged" ? "merged" : checks.state,
        checks: checks.checks,
      }
    : detail;
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
