import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthWorkItemsWriteScope,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcTest from "effect/rpc/RpcTest";
import * as RpcAuthorization from "../auth/RpcAuthorization.ts";
import {
  RpcInstrumentation,
  rpcInstrumentationLayer,
} from "../observability/RpcInstrumentation.ts";
import { layerWorkItemsRpc } from "../ws.ts";
import { WorkItemsService } from "./WorkItemsService.ts";

const group = WsRpcGroup.omit(
  ...[...WsRpcGroup.requests.keys()].filter(
    (
      tag,
    ): tag is Exclude<
      keyof typeof RpcAuthorization.RPC_REQUIRED_SCOPES,
      typeof WS_METHODS.workItemsConnections | typeof WS_METHODS.workItemsCreate
    > => tag !== WS_METHODS.workItemsConnections && tag !== WS_METHODS.workItemsCreate,
  ),
).middleware(RpcInstrumentation);

it.effect("serves the split work-item read handler and rejects writes before the service", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const unused = () => Effect.die("Unexpected work-item service call");
    const service = WorkItemsService.of({
      connections: () =>
        Effect.sync(() => {
          calls.push("connections");
          return [];
        }),
      create: () => Effect.sync(() => calls.push("create")).pipe(Effect.andThen(unused())),
      projects: unused,
      metadata: unused,
      search: unused,
      get: unused,
      receipt: unused,
      recover: unused,
      update: unused,
      relate: unused,
      ready: unused,
    });
    const client = yield* RpcTest.makeClient(group).pipe(
      Effect.provide(
        Layer.mergeAll(
          layerWorkItemsRpc.pipe(Layer.provide(Layer.succeed(WorkItemsService, service))),
          RpcAuthorization.layer([AuthOrchestrationReadScope]),
          rpcInstrumentationLayer,
        ),
      ),
    );
    expect(yield* client[WS_METHODS.workItemsConnections]({})).toEqual([]);
    expect(
      yield* client[WS_METHODS.workItemsCreate]({
        organizationId: "org",
        expectedAccountId: "viewer",
        spaceId: "space",
        category: "Task",
        typeId: "task",
        clientRequestId: "request",
        values: { subject: "Task" },
      }).pipe(Effect.flip),
    ).toMatchObject({
      _tag: "EnvironmentAuthorizationError",
      requiredPermission: AuthWorkItemsWriteScope,
    });
    expect(calls).toEqual(["connections"]);
  }).pipe(Effect.scoped),
);
