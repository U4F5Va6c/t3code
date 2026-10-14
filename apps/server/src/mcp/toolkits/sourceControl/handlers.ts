import * as HostAccess from "./access.ts";
import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SourceControlRepositoryService from "../../../sourceControl/SourceControlRepositoryService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { SourceControlToolkit } from "./tools.ts";

const access = (method: string) =>
  Effect.gen(function* () {
    yield* readCaller();
    yield* HostAccess.access(method, false, "orchestration");
    return yield* SourceControlRepositoryService.SourceControlRepositoryService;
  });
export const layer = McpToolAccess.toLayer(SourceControlToolkit, {
  t3_source_control_publish: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.sourceControlPublishRepository, true, "orchestration");
      const project = yield* HostAccess.project(input.projectId);
      const service = yield* SourceControlRepositoryService.SourceControlRepositoryService;
      return yield* service.publishRepository({ ...input, cwd: project.workspaceRoot });
    }),
  ),
  t3_source_control_lookup: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.sourceControlLookupRepository, false, "orchestration");
      const project = yield* HostAccess.project(input.projectId);
      const service = yield* SourceControlRepositoryService.SourceControlRepositoryService;
      return yield* service.lookupRepository({
        provider: input.provider,
        repository: input.repository,
        cwd: project.workspaceRoot,
      });
    }),
  ),
  t3_source_control_repositories: McpToolAccess.reads((input) =>
    access(WS_METHODS.sourceControlListRepositories).pipe(
      Effect.flatMap((service) => service.listRepositories(input)),
    ),
  ),
  t3_source_control_branches: McpToolAccess.reads((input) =>
    access(WS_METHODS.sourceControlListBranches).pipe(
      Effect.flatMap((service) => service.listBranches(input)),
    ),
  ),
});
