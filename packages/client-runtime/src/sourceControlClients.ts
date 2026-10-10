/**
 * The source control host definitions web and mobile ship, and the one lookup they use.
 *
 * Adding a host means writing its `@t3tools/source-control-<host>` package with a
 * `./client/definition` entry and adding it here; clients then label, list, and check out its
 * change requests without further branches.
 *
 * @module client-runtime/sourceControlClients
 */
import * as AzureDevOps from "@t3tools/source-control-azure-devops/client/definition";
import * as Bitbucket from "@t3tools/source-control-bitbucket/client/definition";
import { makeSourceControlClientRegistry } from "@t3tools/source-control-core/client/definition";
import * as Forgejo from "@t3tools/source-control-forgejo/client/definition";
import * as GitHub from "@t3tools/source-control-github/client/definition";
import * as GitLab from "@t3tools/source-control-gitlab/client/definition";

/**
 * Ordered as the clone picker lists hosts. GitHub comes first because a repository that has not
 * reported its host yet reads as GitHub, which is what clients have always shown there.
 */
const BUILT_IN_SOURCE_CONTROL_CLIENTS = [
  GitHub.definition,
  GitLab.definition,
  Forgejo.definition,
  Bitbucket.definition,
  AzureDevOps.definition,
];

/** `definitions` lists the built-in hosts in that order, for pickers that offer every host. */
export const sourceControlClients = makeSourceControlClientRegistry(
  BUILT_IN_SOURCE_CONTROL_CLIENTS,
);
