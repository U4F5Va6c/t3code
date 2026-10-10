/**
 * GitHub's client definition. Browser- and React Native-safe.
 *
 * @module source-control-github/client/definition
 */
import { SourceControlProviderKind } from "@t3tools/contracts";
import { defineSourceControlClient } from "@t3tools/source-control-core/client/definition";

export const definition = defineSourceControlClient({
  kind: SourceControlProviderKind.make("github"),
  label: "GitHub",
  pickerLabel: "GitHub",
  icon: "github",
  changeRequest: { shortLabel: "PR", singular: "pull request" },
  repositoryPathHint: "owner/repo",
  publicHost: "github.com",
  publishDescription: "github.com",
  publishHost: () => "github.com",
  defaultCloneTransport: "https",
  checkoutCommand: ({ number }) => `gh pr checkout ${number}`,
  authorProfileUrl: (login, repositoryUrl) =>
    login.endsWith("[bot]")
      ? null
      : new URL(`/${encodeURIComponent(login)}`, repositoryUrl).toString(),
  reviewSummaryRequired: () => false,
  isChangeRequestUrl: (url) => url.includes("/pull/"),
});
