import type { PullRequestCheck, PullRequestDetail } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolvePullRequestDetailChecks,
  summarizePendingPullRequestChecks,
} from "./pullRequestChecks.ts";

const detail = (overrides: Partial<PullRequestDetail> = {}): PullRequestDetail =>
  ({ title: "Cache the title", state: "open", checks: [], ...overrides }) as PullRequestDetail;

it("counts pending execution states separately without counting completed checks as running", () => {
  const pending = (pendingReason?: PullRequestCheck["pendingReason"]): PullRequestCheck => ({
    name: "build",
    status: "pending",
    ...(pendingReason === undefined ? {} : { pendingReason }),
    url: null,
    description: null,
  });
  expect(
    summarizePendingPullRequestChecks([
      pending("not-run"),
      pending("queued"),
      pending("queued"),
      pending(),
      pending("unknown"),
      { ...pending(), status: "success" },
    ]),
  ).toBe("1 of 6 not run · 2 of 6 queued · 1 of 6 running · 1 of 6 pending");
  expect(summarizePendingPullRequestChecks([pending()])).toBe("1 of 1 running");
  expect(summarizePendingPullRequestChecks([])).toBe("");
});

describe("resolvePullRequestDetailChecks", () => {
  it("uses fresh checks for detail counts without replacing other PR fields", () => {
    const pending = (name: string): PullRequestCheck => ({
      name,
      status: "pending",
      url: null,
      description: null,
    });
    const original = detail({ checks: [pending("build"), pending("test")] });
    const checks = [pending("build"), { ...pending("test"), status: "success" as const }];
    expect(resolvePullRequestDetailChecks(original, { state: "closed", checks }, true)).toEqual({
      ...original,
      state: "closed",
      checks,
    });
    expect(resolvePullRequestDetailChecks(original, { state: "closed", checks }, false)).toBe(
      original,
    );
    expect(resolvePullRequestDetailChecks(original, null, true)).toBe(original);
    expect(resolvePullRequestDetailChecks(null, { state: "closed", checks }, true)).toBeNull();
  });

  it("keeps newer checks when an older cached detail arrives later", () => {
    const pending: PullRequestCheck = {
      name: "build",
      status: "pending",
      url: null,
      description: null,
    };
    const cached = detail({ observedAt: 1_000, checks: [pending], workflowApprovalsRequired: 1 });
    const checks = {
      state: "open" as const,
      checks: [{ ...pending, status: "success" as const }],
      observedAt: 2_000,
      workflowApprovalsRequired: 0,
    };
    const resolved = resolvePullRequestDetailChecks(cached, checks, false);
    expect(resolved?.checks).toEqual(checks.checks);
    expect(resolved?.workflowApprovalsRequired).toBe(0);
    expect(
      resolvePullRequestDetailChecks(cached, { ...checks, workflowApprovalsRequired: 2 }, false)
        ?.workflowApprovalsRequired,
    ).toBe(2);
    expect(resolved?.observedAt).toBe(1_000);
    expect(
      resolvePullRequestDetailChecks(cached, { state: checks.state, checks: checks.checks }, true)
        ?.workflowApprovalsRequired,
    ).toBe(0);
    expect(
      resolvePullRequestDetailChecks(
        cached,
        {
          state: checks.state,
          checks: [{ ...pending, status: "action-required", placeholder: true }],
        },
        true,
      )?.workflowApprovalsRequired,
    ).toBe(1);
    const refreshed = detail({ observedAt: 3_000, checks: [pending] });
    expect(resolvePullRequestDetailChecks(refreshed, checks, true)).toBe(refreshed);
  });

  it("keeps merged details settled while applying newer checks", () => {
    const merged = detail({ state: "merged", observedAt: 1_000 });
    const checks = [{ name: "build", status: "success" as const, url: null, description: null }];
    expect(
      resolvePullRequestDetailChecks(merged, { state: "open", observedAt: 2_000, checks }, true),
    ).toEqual({ ...merged, checks });
  });
});
