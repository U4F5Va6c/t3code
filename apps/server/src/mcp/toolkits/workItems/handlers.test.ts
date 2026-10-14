import * as ServerSettings from "../../../serverSettings.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as Option from "effect/Option";
import { ProjectId, DEFAULT_SERVER_SETTINGS, ServerSettingsError } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  EnvironmentId,
  ThreadId,
  ProviderInstanceId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import * as Service from "../../../workItems/WorkItemsService.ts";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Access from "../../McpToolAccess.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as Handlers from "./handlers.ts";
import { WorkItemsToolkit } from "./tools.ts";
const env = EnvironmentId.make("env"),
  threadId = ThreadId.make("thread");
const input = {
  organizationId: "org",
  expectedAccountId: "viewer",
  spaceId: "space",
  typeId: "type",
  category: "Task" as const,
  clientRequestId: "key",
  values: { subject: "Title" },
};
const oauth = (
  access: "full-access" | "read-only" | "approval-required",
  scopes: readonly AuthEnvironmentScope[],
): Invocation.McpInvocationScope => ({
  environmentId: env,
  requestNamespace: "test",
  thread: undefined,
  client: { sessionId: "client", label: "test", access, scopes },
  capabilities: new Set(["work-items"]),
  issuedAt: 1,
});
it.effect(
  "enforces OAuth scopes, environment, capability and caller modes before service writes",
  () =>
    Effect.gen(function* () {
      let writes = 0;
      const scopes: Invocation.McpInvocationScope[] = [
        oauth("read-only", ["work-items:write"]),
        oauth("approval-required", ["work-items:write"]),
        oauth("full-access", ["source-control:write"]),
        {
          ...oauth("full-access", ["work-items:write"]),
          environmentId: EnvironmentId.make("other"),
        },
        { ...oauth("full-access", ["work-items:write"]), capabilities: new Set() },
      ];
      for (const modes of [
        { runtimeMode: "approval-required" as const },
        { interactionMode: "plan" as const },
        { activeRunId: null },
        {},
      ]) {
        const deps = Layer.mergeAll(
          ServerSettings.layerTest({ enableAgentWorkItemsAccess: true }),
          Layer.mock(ProjectService.ProjectService)({
            getById: (id) => Effect.succeed(Option.some(project(id))),
          }),
          Layer.mock(Service.WorkItemsService)({
            create: () =>
              Effect.sync(() => {
                writes++;
                return {
                  clientRequestId: "key",
                  status: "pending" as const,
                  itemId: null,
                  item: null,
                };
              }),
          }),
          Layer.mock(Environment.ServerEnvironment)({ getEnvironmentId: Effect.succeed(env) }),
          Layer.mock(Threads.ThreadManagementService)({
            getThreadShell: (id) => Effect.succeed(liveThreadShell(id, modes)),
          }),
        );
        const toolkit = yield* WorkItemsToolkit.pipe(
          Effect.provide(Access.HandlersLayer.layer(Handlers.layer).pipe(Layer.provide(deps))),
        );
        const call = (scope: Invocation.McpInvocationScope) =>
          toolkit
            .handle("t3_work_items_create", input)
            .pipe(
              Stream.unwrap,
              Stream.runCollect,
              Effect.provideService(Invocation.McpInvocationContext, scope),
              Effect.provide(deps),
            );
        for (const scope of scopes) yield* call(scope);
        expect(writes).toBe(0);
        const threadScope = {
          ...oauth("full-access", ["work-items:write"]),
          client: undefined,
          thread: {
            threadId,
            providerInstanceId: ProviderInstanceId.make("codex"),
            providerSessionId: "session",
          },
        };
        yield* call(threadScope);
        if (Object.keys(modes).length) expect(writes).toBe(0);
        else expect(writes).toBe(1);
      }
    }),
);

function project(id: ProjectId) {
  return {
    id,
    title: "Project",
    workspaceRoot: "/tmp",
    repositoryIdentity: null,
    faviconPath: null,
    projectIcon: null,
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    autoPull: false,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  };
}
it.effect(
  "default threads cannot write, explicit opt-in works, revocation and read failure block the same credential immediately",
  () =>
    Effect.gen(function* () {
      let enabled = false,
        readFailed = false,
        writes = 0,
        exists = true;
      const deps = Layer.mergeAll(
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.suspend(() =>
            readFailed
              ? Effect.fail(
                  new ServerSettingsError({
                    settingsPath: "test",
                    operation: "read-file",
                    cause: "unreadable",
                  }),
                )
              : Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, enableAgentWorkItemsAccess: enabled }),
          ),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: (id) => Effect.succeed(exists ? Option.some(project(id)) : Option.none()),
        }),
        Layer.mock(Service.WorkItemsService)({
          create: () =>
            Effect.sync(() => {
              writes++;
              return {
                clientRequestId: "key",
                status: "pending" as const,
                itemId: null,
                item: null,
              };
            }),
        }),
        Layer.mock(Environment.ServerEnvironment)({ getEnvironmentId: Effect.succeed(env) }),
        Layer.mock(Threads.ThreadManagementService)({
          getThreadShell: (id) => Effect.succeed(liveThreadShell(id)),
        }),
      );
      const toolkit = yield* WorkItemsToolkit.pipe(
        Effect.provide(Access.HandlersLayer.layer(Handlers.layer).pipe(Layer.provide(deps))),
      );
      const explicit = {
        ...oauth("full-access", ["work-items:write"]),
        client: undefined,
        thread: {
          threadId,
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: "session",
        },
      };
      const call = (scope: Invocation.McpInvocationScope) =>
        toolkit
          .handle("t3_work_items_create", input)
          .pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.provideService(Invocation.McpInvocationContext, scope),
            Effect.provide(deps),
          );
      yield* call({
        ...explicit,
        capabilities: new Set(["orchestration", "worktree", "pull-requests"]),
      });
      expect(writes).toBe(0);
      yield* call(explicit);
      expect(writes).toBe(0);
      enabled = true;
      yield* call(explicit);
      expect(writes).toBe(1);
      enabled = false;
      yield* call(explicit);
      expect(writes).toBe(1);
      enabled = true;
      readFailed = true;
      yield* call(explicit);
      expect(writes).toBe(1);
      readFailed = false;
      exists = false;
      yield* call(explicit);
      expect(writes).toBe(1);
      // An independently approved OAuth client remains governed by its explicit scopes.
      enabled = false;
      yield* call(oauth("full-access", ["work-items:write"]));
      expect(writes).toBe(2);
    }),
);
