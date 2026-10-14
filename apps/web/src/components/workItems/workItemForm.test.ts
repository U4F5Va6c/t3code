import * as Cause from "effect/Cause";
import { WorkItemError } from "@t3tools/contracts";
import { canCorrectCreation } from "./workItemForm";
import { expect, it } from "vite-plus/test";
import { initialWorkItemValues, workItemFormProblem } from "./workItemForm";
const fields = [
  {
    id: "subject",
    name: "Title",
    format: "string",
    type: "NativeField",
    required: true,
    readOnly: false,
    supported: true,
    defaultValue: null,
    options: [],
  },
  {
    id: "priority",
    name: "Priority",
    format: "list",
    type: "SystemCustomField",
    required: true,
    readOnly: false,
    supported: true,
    defaultValue: "high",
    options: [{ id: "high", name: "High" }],
  },
];
it("uses real metadata defaults and names missing required fields", () => {
  expect(initialWorkItemValues(fields)).toEqual({ priority: "high" });
  expect(workItemFormProblem(fields, { priority: "high" })).toBe("Title is required.");
  expect(workItemFormProblem(fields, { priority: "high", subject: "Bug" })).toBeNull();
});
it("blocks unsupported required formats instead of submitting raw JSON", () => {
  expect(workItemFormProblem([{ ...fields[0]!, supported: false }], {})).toContain("not supported");
});

it("omits empty list defaults while retaining valid defaults and required validation", () => {
  const reason = {
    id: "resolutionReason",
    name: "不修复理由",
    format: "list",
    type: "CustomField",
    required: false,
    readOnly: false,
    supported: true,
    defaultValue: "",
    options: [{ id: "duplicate", name: "重复问题" }],
  };
  const bugFields = [...fields, reason];
  const values = { ...initialWorkItemValues(bugFields), subject: "Bug" };
  expect(values).toEqual({ priority: "high", subject: "Bug" });
  expect(workItemFormProblem(bugFields, values)).toBeNull();
  expect(workItemFormProblem([...fields, { ...reason, required: true }], values)).toBe(
    "不修复理由 is required.",
  );
});

it("only permits correcting errors known to precede creation", () => {
  for (const reason of ["create-not-submitted"] as const)
    expect(canCorrectCreation(Cause.fail(new WorkItemError({ reason })))).toBe(true);
  for (const reason of [
    "invalid-input",
    "unsupported-field",
    "unknown",
    "unavailable",
    "not-found",
    "account-mismatch",
    "conflict",
  ] as const)
    expect(canCorrectCreation(Cause.fail(new WorkItemError({ reason })))).toBe(false);
  expect(canCorrectCreation(Cause.die("lost transport"))).toBe(false);
});
