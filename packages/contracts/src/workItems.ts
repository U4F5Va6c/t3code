import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, PositiveInt } from "./baseSchemas.ts";

export const WorkItemCategory = Schema.Literals(["Req", "Bug", "Task"]);
export const WorkItemRelationType = Schema.Literals(["PARENT", "SUB", "DEPEND_ON", "DEPENDED_BY"]);
export const WorkItemValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.String),
]);
export const WorkItemValues = Schema.Record(Schema.String, WorkItemValue);
export type WorkItemValues = typeof WorkItemValues.Type;
export const WorkItemTarget = Schema.Struct({
  organizationId: TrimmedNonEmptyString,
  expectedAccountId: TrimmedNonEmptyString,
});
export const WorkItemSpace = Schema.Struct({
  ...WorkItemTarget.fields,
  spaceId: TrimmedNonEmptyString,
});
export const WorkItemRef = Schema.Struct({ ...WorkItemSpace.fields, id: TrimmedNonEmptyString });
export type WorkItemRef = typeof WorkItemRef.Type;
export const WorkItemOption = Schema.Struct({ id: Schema.String, name: Schema.String });
export const WorkItemType = Schema.Struct({ ...WorkItemOption.fields, category: WorkItemCategory });
export const WorkItemField = Schema.Struct({
  ...WorkItemOption.fields,
  format: Schema.String,
  type: Schema.String,
  required: Schema.Boolean,
  readOnly: Schema.Boolean,
  supported: Schema.Boolean,
  defaultValue: WorkItemValue,
  options: Schema.Array(WorkItemOption),
});
export const WorkItemMetadata = Schema.Struct({
  types: Schema.Array(WorkItemType),
  fields: Schema.Array(WorkItemField),
  members: Schema.Array(WorkItemOption),
  statuses: Schema.Array(WorkItemOption),
  relationTypes: Schema.Array(
    Schema.Struct({ relationType: WorkItemRelationType, types: Schema.Array(WorkItemType) }),
  ),
});
export const WorkItem = Schema.Struct({
  id: Schema.String,
  serialNumber: Schema.String,
  subject: Schema.String,
  spaceId: Schema.String,
  typeId: Schema.String,
  category: WorkItemCategory,
  gmtModified: Schema.Number,
  formatType: Schema.String,
  creatorId: Schema.String,
  values: WorkItemValues,
  status: WorkItemOption,
  assignedTo: Schema.NullOr(WorkItemOption),
  url: Schema.String,
});
export type WorkItem = typeof WorkItem.Type;
export const WorkItemPage = Schema.Struct({
  items: Schema.Array(WorkItem),
  nextPage: Schema.NullOr(PositiveInt),
});
export const WorkItemProjectPage = Schema.Struct({
  items: Schema.Array(WorkItemOption),
  nextPage: Schema.NullOr(PositiveInt),
});
export const WorkItemConnections = Schema.Array(
  Schema.Struct({ organizationId: Schema.String, viewer: WorkItemOption }),
);
export const WorkItemRelation = Schema.Struct({
  id: Schema.String,
  target: WorkItem,
  statuses: Schema.Array(WorkItemOption),
  relationType: WorkItemRelationType,
});
export const WorkItemDetails = Schema.Struct({
  item: WorkItem,
  metadata: WorkItemMetadata,
  relations: Schema.Array(WorkItemRelation),
});
export const WorkItemCreateReceipt = Schema.Struct({
  clientRequestId: Schema.String,
  status: Schema.Literals(["pending", "unknown", "created"]),
  itemId: Schema.NullOr(Schema.String),
  item: Schema.NullOr(WorkItem),
});
export const WorkItemCreateInput = Schema.Struct({
  ...WorkItemSpace.fields,
  typeId: TrimmedNonEmptyString,
  category: WorkItemCategory,
  clientRequestId: TrimmedNonEmptyString,
  values: WorkItemValues,
});
export type WorkItemCreateInput = typeof WorkItemCreateInput.Type;
export const WorkItemReceiptInput = Schema.Struct({
  ...WorkItemTarget.fields,
  clientRequestId: TrimmedNonEmptyString,
});
export const WorkItemRecoverInput = Schema.Struct({
  ...WorkItemCreateInput.fields,
  candidateId: TrimmedNonEmptyString,
});
export const WorkItemUpdateInput = Schema.Struct({
  ...WorkItemRef.fields,
  expectedModified: Schema.Number,
  previous: WorkItemValues,
  changes: WorkItemValues,
});
export const WorkItemRelateInput = Schema.Struct({
  ...WorkItemRef.fields,
  targetId: TrimmedNonEmptyString,
  relationType: WorkItemRelationType,
  remove: Schema.Boolean,
  expectedModified: Schema.Number,
});
export const WorkItemReadyInput = Schema.Struct({
  ...WorkItemRef.fields,
  terminalStatusIds: Schema.Array(TrimmedNonEmptyString),
});
export const WorkItemReady = Schema.Struct({
  ready: Schema.Boolean,
  blockers: Schema.Array(WorkItem),
  complete: Schema.Boolean,
});
export class WorkItemError extends Schema.TaggedError<WorkItemError>()("WorkItemError", {
  reason: Schema.Literals([
    "invalid-input",
    "unsupported-field",
    "account-mismatch",
    "conflict",
    "unknown",
    "not-found",
    "unavailable",
    "incomplete",
    "cycle",
    "relation-not-allowed",
    "create-not-submitted",
  ]),
  relation: Schema.optional(
    Schema.Struct({
      kind: WorkItemRelationType,
      sourceType: Schema.String,
      targetType: Schema.String,
    }),
  ),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    if (this.reason === "relation-not-allowed")
      return `ProjeX does not allow ${this.relation?.kind} from type ${this.relation?.sourceType} to type ${this.relation?.targetType}. Ask an organization administrator to configure relationships between these work item types.`;
    return {
      "create-not-submitted":
        "No work item was submitted. Check the fields and project metadata, then try again.",
      "invalid-input": "Work item input or ownership is invalid.",
      "unsupported-field":
        "A required field format is not supported. Use ProjeX to edit this field.",
      "account-mismatch": "The platform account changed. Select the current account again.",
      conflict: "The work item changed. Refresh before editing again.",
      unknown:
        "The write could not be confirmed. Read its receipt or refresh before retrying; do not create a new request.",
      "not-found": "The work item or creation receipt was not found.",
      unavailable: "ProjeX could not complete the request.",
      incomplete: "Dependency data is incomplete; readiness cannot be confirmed.",
      cycle: "This relationship would create a cycle.",
    }[this.reason];
  }
}
export const WORK_ITEM_OPERATIONS = {
  connections: {
    input: Schema.Struct({ organizationId: Schema.optional(TrimmedNonEmptyString) }),
    output: WorkItemConnections,
  },
  projects: {
    input: Schema.Struct({
      ...WorkItemTarget.fields,
      page: PositiveInt,
      perPage: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
    }),
    output: WorkItemProjectPage,
  },
  metadata: {
    input: Schema.Struct({
      ...WorkItemSpace.fields,
      category: WorkItemCategory,
      typeId: Schema.optional(TrimmedNonEmptyString),
    }),
    output: WorkItemMetadata,
  },
  search: {
    input: Schema.Struct({
      ...WorkItemSpace.fields,
      category: WorkItemCategory,
      page: PositiveInt,
      perPage: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
      subject: Schema.optional(Schema.String),
      statusId: Schema.optional(Schema.String),
      assignedTo: Schema.optional(Schema.String),
    }),
    output: WorkItemPage,
  },
  get: { input: WorkItemRef, output: WorkItemDetails },
  create: { input: WorkItemCreateInput, output: WorkItemCreateReceipt },
  receipt: { input: WorkItemReceiptInput, output: WorkItemCreateReceipt },
  recover: { input: WorkItemRecoverInput, output: WorkItemCreateReceipt },
  update: { input: WorkItemUpdateInput, output: WorkItem },
  relate: { input: WorkItemRelateInput, output: Schema.Array(WorkItemRelation) },
  ready: { input: WorkItemReadyInput, output: WorkItemReady },
} as const;

export type WorkItemField = typeof WorkItemField.Type;
export type WorkItemType = typeof WorkItemType.Type;
export type WorkItemOption = typeof WorkItemOption.Type;
export type WorkItemMetadata = typeof WorkItemMetadata.Type;
export type WorkItemRelationType = typeof WorkItemRelationType.Type;
export type WorkItemRelation = typeof WorkItemRelation.Type;

export type WorkItemCategory = typeof WorkItemCategory.Type;
