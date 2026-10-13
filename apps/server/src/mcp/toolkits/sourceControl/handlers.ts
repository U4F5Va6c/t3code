import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as SourceControlRepositoryService from "../../../sourceControl/SourceControlRepositoryService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { SourceControlToolkit } from "./tools.ts";

const access = Effect.gen(function* () {
  const { scope } = yield* readCaller();
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  if (environmentId !== scope.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential belongs to another environment.",
    });
  return yield* SourceControlRepositoryService.SourceControlRepositoryService;
});
export const layer = McpToolAccess.toLayer(SourceControlToolkit, {
  t3_source_control_repositories: McpToolAccess.reads((input) =>
    access.pipe(Effect.flatMap((service) => service.listRepositories(input))),
  ),
  t3_source_control_branches: McpToolAccess.reads((input) =>
    access.pipe(Effect.flatMap((service) => service.listBranches(input))),
  ),
});
