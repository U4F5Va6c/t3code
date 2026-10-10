import {
  type ChangeRequestCheckoutInput,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@t3tools/source-control-core/client/definition";
import { describe, expect, it } from "vite-plus/test";

import { sourceControlClients } from "./sourceControlClients.ts";

describe("sourceControlClients", () => {
  it("reads a missing kind as GitHub and an unshipped kind as the generic host", () => {
    expect(sourceControlClients.get(undefined).kind).toBe("github");
    expect(sourceControlClients.get(null).kind).toBe("github");
    expect(sourceControlClients.get("unknown")).toBe(UNKNOWN_SOURCE_CONTROL_CLIENT);
    expect(sourceControlClients.get("gitcafe")).toBe(UNKNOWN_SOURCE_CONTROL_CLIENT);
    expect(sourceControlClients.find("gitcafe")).toBeUndefined();
    expect(UNKNOWN_SOURCE_CONTROL_CLIENT.changeRequest).toEqual({
      shortLabel: "change request",
      singular: "change request",
    });
  });

  it("attributes change request URLs by their path shape", () => {
    const kindOf = (url: string) => sourceControlClients.findByChangeRequestUrl(url)?.kind;
    expect(kindOf("https://github.com/acme/web/pull/7")).toBe("github");
    expect(kindOf("https://gitlab.example/group/sub/web/-/merge_requests/7")).toBe("gitlab");
    expect(kindOf("https://codeberg.org/acme/web/pulls/7")).toBe("forgejo");
    expect(kindOf("https://bitbucket.org/acme/web/pull-requests/7")).toBe("bitbucket");
    expect(kindOf("https://dev.azure.com/org/project/_git/web/pullrequest/7")).toBe("azure-devops");
    expect(kindOf("https://example.com/acme/web/issues/7")).toBeUndefined();
  });

  it("attributes only public hostnames that name exactly one host", () => {
    expect(sourceControlClients.findByPublicHost("GitHub.com")?.kind).toBe("github");
    expect(sourceControlClients.findByPublicHost("gitlab.com")?.kind).toBe("gitlab");
    expect(sourceControlClients.findByPublicHost("codeberg.org")).toBeUndefined();
    expect(sourceControlClients.findByPublicHost("dev.azure.com")).toBeUndefined();
  });

  it("builds each host's checkout command", () => {
    const checkout = (kind: string, input: ChangeRequestCheckoutInput) =>
      sourceControlClients.get(kind).checkoutCommand(input);
    expect(checkout("github", { number: 42, headBranch: "" })).toBe("gh pr checkout 42");
    expect(checkout("gitlab", { number: 42, headBranch: "" })).toBe("glab mr checkout 42");
    expect(checkout("azure-devops", { number: 42, headBranch: "" })).toBe(
      "az repos pr checkout --id 42",
    );
    expect(checkout("unknown", { number: 42, headBranch: "feature" })).toBeNull();
    expect(checkout("forgejo", { number: 42, headBranch: "feature" })).toBeNull();
    expect(
      checkout("forgejo", {
        number: 42,
        headBranch: "feature",
        repositoryUrl: "https://forgejo.local/maria/repo'$(echo nope)",
      }),
    ).toBe(
      "git fetch 'https://forgejo.local/maria/repo'\\''$(echo nope)' refs/pull/42/head && git checkout -B pulls/42 FETCH_HEAD",
    );
    expect(
      checkout("bitbucket", {
        number: 42,
        headBranch: "feature/checkout",
        headRepositoryNameWithOwner: "maria/t3code",
      }),
    ).toBe(
      "git clone --single-branch --branch feature/checkout https://bitbucket.org/maria/t3code.git t3code-pr-42",
    );
    expect(
      checkout("bitbucket", {
        number: 42,
        headBranch: "feature;rm -rf /",
        headRepositoryNameWithOwner: "maria/t3code",
      }),
    ).toBeNull();
  });

  it("links GitHub author profiles but not bots, and no other host's", () => {
    const github = sourceControlClients.get("github");
    expect(github.authorProfileUrl("octo cat", "https://ghe.example/acme/web")).toBe(
      "https://ghe.example/octo%20cat",
    );
    expect(github.authorProfileUrl("renovate[bot]", "https://github.com/acme/web")).toBeNull();
    expect(
      sourceControlClients.get("gitlab").authorProfileUrl("octocat", "https://gitlab.com/a/b"),
    ).toBeNull();
  });

  it("asks only Forgejo for a summary when requesting changes", () => {
    expect(sourceControlClients.get("forgejo").reviewSummaryRequired("request-changes")).toBe(true);
    expect(sourceControlClients.get("forgejo").reviewSummaryRequired("approve")).toBe(false);
    expect(sourceControlClients.get("github").reviewSummaryRequired("request-changes")).toBe(false);
  });
});
