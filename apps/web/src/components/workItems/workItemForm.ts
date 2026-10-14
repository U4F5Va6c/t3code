import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { WorkItemError } from "@t3tools/contracts";
import type { WorkItemField, WorkItemValues, WorkItem } from "@t3tools/contracts";
export function initialWorkItemValues(fields: readonly WorkItemField[]) {
  return Object.fromEntries(
    fields
      .filter((f) => f.supported && f.defaultValue !== null && f.defaultValue !== "")
      .map((f) => [f.id, f.defaultValue]),
  );
}
export function workItemFormProblem(fields: readonly WorkItemField[], values: WorkItemValues) {
  for (const f of fields.filter((f) => f.required && !f.readOnly)) {
    if (!f.supported) return `${f.name}: this required field format is not supported. Use ProjeX.`;
    const v = values[f.id];
    if (
      v == null ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0)
    )
      return `${f.name} is required.`;
  }
  return null;
}
export function changedWorkItemFields(item: WorkItem, values: WorkItemValues) {
  const changes = Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => JSON.stringify(item.values[key]) !== JSON.stringify(value),
    ),
  );
  const previous = Object.fromEntries(
    Object.keys(changes).map((key) => [key, item.values[key] ?? null]),
  );
  return { changes, previous };
}

/** Only this explicit service error precedes the durable reservation and platform POST. */
const isWorkItemError = Schema.is(WorkItemError);
export function canCorrectCreation(cause: Cause.Cause<unknown>) {
  const error = Option.getOrNull(Cause.findErrorOption(cause));
  return isWorkItemError(error) && error.reason === "create-not-submitted";
}
