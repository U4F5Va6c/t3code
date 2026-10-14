import { OrchestratorMcpFailure, type ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { requiredScopeForRpcMethod } from "../../../auth/RpcAuthorization.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { assertFullAccess, assertLiveCaller, loadCaller } from "../../threadAccess.ts";

/** New host tools use the same OAuth grant as their RPC counterpart. */
export const access = Effect.fn("SourceControlMcp.access")(function* (
  method: string,
  write: boolean,
  capability: "orchestration" | "pull-requests" | "work-items",
) {
  const scope = yield* McpInvocationContext.requireMcpCapability(capability);
  const environment = yield* ServerEnvironment.ServerEnvironment;
  if ((yield* environment.getEnvironmentId) !== scope.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential belongs to another environment.",
    });
  const caller = yield* loadCaller();
  if (
    scope.client !== undefined &&
    !scope.client.scopes?.includes(requiredScopeForRpcMethod(method))
  )
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: `This credential lacks ${requiredScopeForRpcMethod(method)}.`,
    });
  if (write) {
    yield* assertLiveCaller(caller);
    yield* assertFullAccess(caller, "Remote writes require full-access/default mode.");
  }
});

export const project = Effect.fn("SourceControlMcp.project")(function* (projectId: ProjectId) {
  const projects = yield* ProjectService.ProjectService;
  const found = yield* projects.getShell(projectId).pipe(
    Effect.mapError(
      () =>
        new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Project not found in this environment.",
        }),
    ),
  );
  if (Option.isNone(found))
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "Project not found in this environment.",
    });
  return found.value;
});
