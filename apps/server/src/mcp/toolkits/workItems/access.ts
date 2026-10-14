import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ServerSettings from "../../../serverSettings.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as HostAccess from "../sourceControl/access.ts";
import { loadCaller } from "../../threadAccess.ts";

/** Re-read the opt-in so revocation also blocks a running provider's old credential. */
export const access = Effect.fn("WorkItemsMcp.access")(function* (method: string, write: boolean) {
  yield* HostAccess.access(method, write, "work-items");
  const { caller } = yield* loadCaller();
  if (caller === undefined) return;
  const allowed = yield* Effect.gen(function* () {
    const settings = yield* (yield* ServerSettings.ServerSettingsService).getSettings;
    const project = yield* (yield* ProjectService.ProjectService).getById(caller.projectId);
    return (
      Option.isSome(project) &&
      resolveProjectSettings(settings, caller.projectId).settings.enableAgentWorkItemsAccess
    );
  }).pipe(Effect.orElseSucceed(() => false));
  if (!allowed)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message:
        "Agent work item access is disabled for this project. Enable it in project or environment settings.",
    });
});
