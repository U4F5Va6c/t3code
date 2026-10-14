import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
export function createWorkItemsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  return {
    connections: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "workItems:connections",
      tag: WS_METHODS.workItemsConnections,
    }),
    projects: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "workItems:projects",
      tag: WS_METHODS.workItemsProjects,
    }),
    metadata: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "workItems:metadata",
      tag: WS_METHODS.workItemsMetadata,
    }),
    search: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "workItems:search",
      tag: WS_METHODS.workItemsSearch,
    }),
    get: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "workItems:get",
      tag: WS_METHODS.workItemsGet,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "workItems:create",
      tag: WS_METHODS.workItemsCreate,
      scheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    receipt: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "workItems:receipt",
      tag: WS_METHODS.workItemsReceipt,
    }),
    recover: createEnvironmentRpcCommand(runtime, {
      label: "workItems:recover",
      tag: WS_METHODS.workItemsRecover,
      scheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    update: createEnvironmentRpcCommand(runtime, {
      label: "workItems:update",
      tag: WS_METHODS.workItemsUpdate,
      scheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    relate: createEnvironmentRpcCommand(runtime, {
      label: "workItems:relate",
      tag: WS_METHODS.workItemsRelate,
      scheduler,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    ready: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "workItems:ready",
      tag: WS_METHODS.workItemsReady,
    }),
  };
}
