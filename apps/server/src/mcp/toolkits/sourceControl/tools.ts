import {
  OrchestratorMcpFailure,
  SourceControlRepositoryError,
  SourceControlRepositoryDirectoryInput,
  SourceControlRepositoryDirectoryResult,
  SourceControlRepositoryBranchesInput,
  SourceControlRepositoryBranchesResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as SourceControlRepositoryService from "../../../sourceControl/SourceControlRepositoryService.ts";

const shared = {
  failure: Schema.Union([OrchestratorMcpFailure, SourceControlRepositoryError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    SourceControlRepositoryService.SourceControlRepositoryService,
  ],
};
export const SourceControlToolkit = Toolkit.make(
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
