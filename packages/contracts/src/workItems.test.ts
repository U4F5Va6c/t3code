import { sessionGrantsScope } from "./auth.ts";
import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { WORK_ITEM_OPERATIONS, WorkItemCreateInput, WorkItemUpdateInput } from "./workItems.ts";
it("requires explicit organization/account and persistent creation ID", () => {
  const create = Schema.decodeUnknownSync(WorkItemCreateInput);
  expect(() =>
    create({ spaceId: "space", typeId: "type", category: "Task", values: { subject: "A" } }),
  ).toThrow();
  expect(
    create({
      organizationId: "org",
      expectedAccountId: "viewer",
      spaceId: "space",
      typeId: "type",
      category: "Task",
      clientRequestId: "request",
      values: { subject: "A" },
    }).clientRequestId,
  ).toBe("request");
});
it("rejects missing revision and bounds pagination", () => {
  expect(() =>
    Schema.decodeUnknownSync(WorkItemUpdateInput)({
      organizationId: "org",
      expectedAccountId: "viewer",
      spaceId: "s",
      id: "id",
      previous: {},
      changes: {},
    }),
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(WORK_ITEM_OPERATIONS.projects.input)({
      organizationId: "org",
      expectedAccountId: "viewer",
      page: 1,
      perPage: 201,
    }),
  ).toThrow();
});

it("does not infer work-item writes from old broad or source-control grants", () => {
  for (const scopes of [["orchestration:operate"], ["source-control:write"]] as const)
    expect(sessionGrantsScope({ authenticated: true, scopes }, "work-items:write")).toBe(false);
  expect(
    sessionGrantsScope({ authenticated: true, scopes: ["work-items:write"] }, "work-items:write"),
  ).toBe(true);
});
