import { expect, it } from "vite-plus/test";
import {
  encodeFields,
  parseFields,
  parseRelationIds,
  parseRelationTypes,
  parseTypes,
  parseWorkItem,
} from "./ProjexApi.ts";
const fields = parseFields([
  { id: "subject", name: "Title", format: "string", type: "NativeField", required: true },
  {
    id: "priority",
    name: "Priority",
    format: "multiList",
    type: "SystemCustomField",
    required: true,
    options: [
      { id: "p1", displayValue: "High" },
      { id: "p2", displayValue: "Low" },
    ],
  },
]);
it("uses create maps and comma values, but update arrays, without inventing required options", () => {
  expect(encodeFields(fields, { subject: "Item", priority: ["p1", "p2"] }, true)).toEqual({
    subject: "Item",
    customFieldValues: { priority: "p1,p2" },
    formatType: "MARKDOWN",
  });
  expect(encodeFields(fields, { priority: ["p2"] }, false)).toEqual({ priority: ["p2"] });
  expect(() => encodeFields(fields, { subject: "Item" }, true)).toThrow();
  expect(() => encodeFields(fields, { subject: "Item", priority: "invented" }, true)).toThrow();
});
it("keeps unsupported required fields blocking and auto fields read-only", () => {
  const unsupported = parseFields([
    { id: "f", name: "Field", format: "unknown", type: "CustomField", required: true },
    { id: "a", name: "Summary", format: "auto", type: "CustomField", required: false },
  ]);
  expect(() => encodeFields(unsupported, { f: "x" }, true)).toThrow();
  expect(() => encodeFields(unsupported, { a: "x" }, false)).toThrow();
});
it("accepts real category relation records and rejects malformed targets", () => {
  expect(parseRelationIds([{ id: "edge", resourceId: "item", resourceType: "Task" }])).toEqual([
    { id: "edge", targetId: "item" },
  ]);
  expect(() => parseRelationIds([{ id: "edge", resourceType: "Task" }])).toThrow();
});
it("preserves API identity, serial number, numeric revision and nested field values", () => {
  const item = parseWorkItem({
    id: "id",
    serialNumber: "P-1",
    subject: "A",
    space: { id: "space" },
    workitemType: { id: "type" },
    categoryId: "Bug",
    gmtModified: 42,
    formatType: "RICHTEXT",
    status: { id: "s", name: "State" },
    assignedTo: { id: "u", name: "User" },
    customFieldValues: [{ fieldId: "priority", values: [{ identifier: "p" }] }],
  });
  expect(item).toMatchObject({
    id: "id",
    serialNumber: "P-1",
    gmtModified: 42,
    spaceId: "space",
    typeId: "type",
    formatType: "RICHTEXT",
    values: { priority: "p", assignedTo: "u", status: "s" },
  });
});
it("preserves single multi-values and rejects unsupported dates and invalid scalar shapes", () => {
  const item = parseWorkItem({
    id: "id",
    serialNumber: "P-1",
    subject: "A",
    space: { id: "space" },
    workitemType: { id: "type" },
    categoryId: "Task",
    gmtModified: 1,
    status: { id: "s", name: "S" },
    customFieldValues: [
      { fieldId: "m", fieldFormat: "multiList", values: [{ identifier: "a" }] },
      { fieldId: "u", fieldFormat: "multiUser", values: [{ identifier: "u" }] },
      { fieldId: "n", fieldFormat: "number", values: [{ identifier: "0" }] },
    ],
  });
  expect(item.values).toMatchObject({ m: ["a"], u: ["u"], n: 0 });
  const numbers = parseFields([
    { id: "n", name: "Number", format: "number", type: "CustomField", required: true },
  ]);
  expect(encodeFields(numbers, { n: 0 }, true)).toMatchObject({ customFieldValues: { n: "0" } });
  for (const n of ["", "0", [], ["1"], null, true, Infinity])
    expect(() => encodeFields(numbers, { n }, true)).toThrow();
  for (const subject of ["  ", [], true, 0])
    expect(() => encodeFields(fields, { subject, priority: ["p1"] }, true)).toThrow();
  expect(() => encodeFields(fields, { subject: "A", priority: "p1" }, true)).toThrow();
  expect(
    parseFields([{ id: "d", name: "Date", format: "date", type: "CustomField", required: true }])[0]
      ?.supported,
  ).toBe(false);
});
it("filters only unsupported advertised relation categories and preserves strict item/type parsing", () => {
  const rows = [
    { id: "feedback", name: "Feedback", categoryId: "Request" },
    { id: "req", name: "Requirement", categoryId: "Req" },
    { id: "topic", name: "Topic", categoryId: "Topic" },
    { id: "task", name: "Task", categoryId: "Task" },
    { id: "bug", name: "Bug", categoryId: "Bug" },
  ];
  expect(parseRelationTypes([{ relationType: "DEPENDED_BY", workitemTypeList: rows }])).toEqual([
    { id: "req", name: "Requirement", category: "Req" },
    { id: "task", name: "Task", category: "Task" },
    { id: "bug", name: "Bug", category: "Bug" },
  ]);
  expect(parseRelationTypes([{ workitemTypeList: [rows[0], rows[2]] }])).toEqual([]);
  expect(() => parseTypes(rows)).toThrow();
  expect(() => parseWorkItem({ categoryId: "Topic" })).toThrow();
  for (const malformed of [
    { id: "x", name: "X" },
    { id: "x", name: "X", categoryId: null },
    { id: "x", name: "X", categoryId: 3 },
    { id: "x", name: "X", categoryId: " " },
    { name: "X", categoryId: "Topic" },
  ])
    expect(() => parseRelationTypes([{ workitemTypeList: [malformed] }])).toThrow();
  expect(() => parseRelationTypes([{ workitemTypeList: null }])).toThrow();
});
