import * as ServerSettings from "../../../serverSettings.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import {
  WORK_ITEM_OPERATIONS,
  WorkItemError,
  OrchestratorMcpFailure,
  McpCapabilityUnavailableError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";
import * as WorkItemsService from "../../../workItems/WorkItemsService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
const shared = {
  failure: Schema.Union([WorkItemError, OrchestratorMcpFailure, McpCapabilityUnavailableError]),
  failureMode: "return" as const,
  dependencies: [
    WorkItemsService.WorkItemsService,
    ServerSettings.ServerSettingsService,
    ProjectService.ProjectService,
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
  ],
};
export const WorkItemsToolkit = Toolkit.make(
  Tool.make("t3_work_items_connections", {
    ...shared,
    description:
      "Read configured ProjeX organizations and actual viewer identities. No repository binding.",
    parameters: WORK_ITEM_OPERATIONS.connections.input,
    success: WORK_ITEM_OPERATIONS.connections.output,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_work_items_projects", {
    ...shared,
    description: "Read one conservative page of accessible ProjeX projects.",
    parameters: WORK_ITEM_OPERATIONS.projects.input,
    success: WORK_ITEM_OPERATIONS.projects.output,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_work_items_metadata", {
    ...shared,
    description:
      "Read actual types, required fields, members, statuses and allowed relation types.",
    parameters: WORK_ITEM_OPERATIONS.metadata.input,
    success: WORK_ITEM_OPERATIONS.metadata.output,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_work_items_search", {
    ...shared,
    description:
      "Search one space/category with subject, state and owner filters. Follow nextPage until null.",
    parameters: WORK_ITEM_OPERATIONS.search.input,
    success: WORK_ITEM_OPERATIONS.search.output,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_work_items_get", {
    ...shared,
    description: "Read item detail, current metadata and all four directed relations.",
    parameters: WORK_ITEM_OPERATIONS.get.input,
    success: WORK_ITEM_OPERATIONS.get.output,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_work_items_create", {
    ...shared,
    description:
      "Create once with an explicit clientRequestId. Pending/unknown receipts NEVER authorize another POST. Keep the original request ID and payload; use receipt/recover after uncertainty.",
    parameters: WORK_ITEM_OPERATIONS.create.input,
    success: WORK_ITEM_OPERATIONS.create.output,
  }).annotate(Tool.Readonly, false),
  Tool.make("t3_work_items_receipt", {
    ...shared,
    description: "Read persistent creation outcome by the original clientRequestId.",
    parameters: WORK_ITEM_OPERATIONS.receipt.input,
    success: WORK_ITEM_OPERATIONS.receipt.output,
  }).annotate(Tool.Readonly, true),
  Tool.make("t3_work_items_recover", {
    ...shared,
    description:
      "Recover an unknown creation only by explicit candidateId whose space/type/fields match the original payload. Does not POST.",
    parameters: WORK_ITEM_OPERATIONS.recover.input,
    success: WORK_ITEM_OPERATIONS.recover.output,
  }).annotate(Tool.Readonly, false),
  Tool.make("t3_work_items_update", {
    ...shared,
    description:
      "Update specified fields after expectedModified and previous-field checks. No atomic platform CAS; conflicts require refresh. State IDs come from workflow and platform may reject illegal transitions.",
    parameters: WORK_ITEM_OPERATIONS.update.input,
    success: WORK_ITEM_OPERATIONS.update.output,
  }).annotate(Tool.Readonly, false),
  Tool.make("t3_work_items_relate", {
    ...shared,
    description:
      "Add/remove a directed parent or dependency edge with type, cycle and two-sided readback checks. No item deletion.",
    parameters: WORK_ITEM_OPERATIONS.relate.input,
    success: WORK_ITEM_OPERATIONS.relate.output,
  }).annotate(Tool.Readonly, false),
  Tool.make("t3_work_items_ready", {
    ...shared,
    description:
      "Read ALL dependency targets. Explicit terminalStatusIds define readiness; unknown/incomplete data fails closed. No guessed ready label or assignee semantics.",
    parameters: WORK_ITEM_OPERATIONS.ready.input,
    success: WORK_ITEM_OPERATIONS.ready.output,
  }).annotate(Tool.Readonly, true),
);
