/**
 * Bitbucket's client definition. Browser- and React Native-safe.
 *
 * @module source-control-bitbucket/client/definition
 */
import { SourceControlProviderKind } from "@t3tools/contracts";
import { defineSourceControlClient } from "@t3tools/source-control-core/client/definition";

const safeShellArgument = /^[A-Za-z0-9._/@+=,-]+$/;
const repositoryName = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export const definition = defineSourceControlClient({
  kind: SourceControlProviderKind.make("bitbucket"),
  label: "Bitbucket",
  pickerLabel: "Bitbucket",
  icon: "bitbucket",
  changeRequest: { shortLabel: "PR", singular: "pull request" },
  repositoryPathHint: "workspace/repository",
  publicHost: "bitbucket.org",
  publishDescription: "bitbucket.org",
  publishHost: () => "bitbucket.org",
  defaultCloneTransport: "ssh",
  // Bitbucket has no checkout CLI, so clone the head branch from its own repository.
  checkoutCommand: ({ number, headBranch, headRepositoryNameWithOwner }) =>
    headRepositoryNameWithOwner &&
    repositoryName.test(headRepositoryNameWithOwner) &&
    safeShellArgument.test(headBranch)
      ? `git clone --single-branch --branch ${headBranch} https://bitbucket.org/${headRepositoryNameWithOwner}.git t3code-pr-${number}`
      : null,
  authorProfileUrl: () => null,
  reviewSummaryRequired: () => false,
  isChangeRequestUrl: (url) => url.includes("/pull-requests/"),
});
