import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HostAccess from "./access.ts";
import * as WorkItemsService from "../../../workItems/WorkItemsService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { WorkItemsToolkit } from "./tools.ts";
export const layer = McpToolAccess.toLayer(WorkItemsToolkit, {
  t3_work_items_connections: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsConnections, false);
      return yield* (yield* WorkItemsService.WorkItemsService).connections(input);
    }),
  ),
  t3_work_items_projects: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsProjects, false);
      return yield* (yield* WorkItemsService.WorkItemsService).projects(input);
    }),
  ),
  t3_work_items_metadata: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsMetadata, false);
      return yield* (yield* WorkItemsService.WorkItemsService).metadata(input);
    }),
  ),
  t3_work_items_search: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsSearch, false);
      return yield* (yield* WorkItemsService.WorkItemsService).search(input);
    }),
  ),
  t3_work_items_get: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsGet, false);
      return yield* (yield* WorkItemsService.WorkItemsService).get(input);
    }),
  ),
  t3_work_items_create: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsCreate, true);
      return yield* (yield* WorkItemsService.WorkItemsService).create(input);
    }),
  ),
  t3_work_items_receipt: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsReceipt, false);
      return yield* (yield* WorkItemsService.WorkItemsService).receipt(input);
    }),
  ),
  t3_work_items_recover: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsRecover, true);
      return yield* (yield* WorkItemsService.WorkItemsService).recover(input);
    }),
  ),
  t3_work_items_update: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsUpdate, true);
      return yield* (yield* WorkItemsService.WorkItemsService).update(input);
    }),
  ),
  t3_work_items_relate: McpToolAccess.writesWithCapability((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsRelate, true);
      return yield* (yield* WorkItemsService.WorkItemsService).relate(input);
    }),
  ),
  t3_work_items_ready: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* HostAccess.access(WS_METHODS.workItemsReady, false);
      return yield* (yield* WorkItemsService.WorkItemsService).ready(input);
    }),
  ),
});
