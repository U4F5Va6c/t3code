import {
  OrchestratorMcpFailure,
  McpCapabilityUnavailableError,
  ProjectId,
  SourceControlRepositoryLookupInput,
  SourceControlRepositoryInfo,
  SourceControlPublishRepositoryInput,
  SourceControlPublishRepositoryResult,
  SourceControlRepositoryError,
  SourceControlRepositoryDirectoryInput,
  SourceControlRepositoryDirectoryResult,
  SourceControlRepositoryBranchesInput,
  SourceControlRepositoryBranchesResult,
} from "@t3tools/contracts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as SourceControlRepositoryService from "../../../sourceControl/SourceControlRepositoryService.ts";

const shared = {
  failure: Schema.Union([
    OrchestratorMcpFailure,
    McpCapabilityUnavailableError,
    SourceControlRepositoryError,
  ]),
  failureMode: "return" as const,
  dependencies: [
    ProjectService.ProjectService,
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    SourceControlRepositoryService.SourceControlRepositoryService,
  ],
};
export const SourceControlToolkit = Toolkit.make(
  Tool.make("t3_source_control_publish", {
    ...shared,
    description:
      "Publish the validated project's current branch to a platform repository. Codeup Central Edition supports only explicit organization-id/name and private visibility; internal/public and nested namespaces are rejected. Retries read back the existing private repository before pushing; Git rejects conflicting history without force. No local commit is created.",
    parameters: Schema.Struct({
      projectId: ProjectId,
      provider: SourceControlPublishRepositoryInput.fields.provider,
      repository: SourceControlPublishRepositoryInput.fields.repository,
      visibility: SourceControlPublishRepositoryInput.fields.visibility,
      protocol: SourceControlPublishRepositoryInput.fields.protocol,
      remoteName: SourceControlPublishRepositoryInput.fields.remoteName,
    }),
    success: SourceControlPublishRepositoryResult,
  }).annotate(Tool.Readonly, false),

  Tool.make("t3_source_control_lookup", {
    ...shared,
    description:
      "Resolve a platform repository in this environment with its full organization/namespace path and clone URLs. projectId supplies a validated checkout context; no files or remote repository are changed.",
    parameters: Schema.Struct({
      projectId: ProjectId,
      provider: SourceControlRepositoryLookupInput.fields.provider,
      repository: SourceControlRepositoryLookupInput.fields.repository,
    }),
    success: SourceControlRepositoryInfo,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_source_control_repositories", {
    ...shared,
    description:
      "Browse one page of repositories in an explicit organization on this environment. Codeup Central Edition uses provider codeup and apiHost openapi-rdc.aliyuncs.com. nextPage is conservative; a final empty page is possible. defaultBranch is null when unavailable; use the branches tool to read the actual default branch.",
    parameters: SourceControlRepositoryDirectoryInput,
    success: SourceControlRepositoryDirectoryResult,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
  Tool.make("t3_source_control_branches", {
    ...shared,
    description:
      "Read one page of platform branches, commit SHAs and the repository's actual default branch on this environment. Pass the repositoryId and full nameWithOwner from the repository directory as repository. No checkout or mutation occurs.",
    parameters: SourceControlRepositoryBranchesInput,
    success: SourceControlRepositoryBranchesResult,
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);
