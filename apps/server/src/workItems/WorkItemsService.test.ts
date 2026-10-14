import * as Context from "effect/Context";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Crypto from "effect/Crypto";
import { EnvironmentId, WorkItemError } from "@t3tools/contracts";
import * as Projex from "@t3tools/source-control-codeup/server/ProjexApi";
import * as SourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as Service from "./WorkItemsService.ts";
import * as Receipts from "../persistence/WorkItemCreationReceiptRepository.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import type { CodeupRequest } from "@t3tools/source-control-codeup/server/CodeupApi";
const target = { organizationId: "org", expectedAccountId: "viewer", spaceId: "space" };
const create = {
  ...target,
  typeId: "type",
  category: "Task" as const,
  clientRequestId: "request",
  values: { subject: "Title", assignedTo: "viewer" },
};
const raw = {
  creator: { id: "viewer" },
  id: "item",
  serialNumber: "P-1",
  space: { id: "space" },
  workitemType: { id: "type" },
  categoryId: "Task",
  gmtModified: 1,
  subject: "Title",
  description: "Untouched",
  formatType: "MARKDOWN",
  assignedTo: { id: "viewer", name: "Viewer" },
  status: { id: "todo", name: "Todo" },
};
const fields = [
  { id: "subject", name: "Title", format: "string", type: "NativeField", required: true },
  { id: "assignedTo", name: "Owner", format: "user", type: "NativeField", required: true },
  {
    id: "description",
    name: "Description",
    format: "string",
    type: "NativeField",
    required: false,
  },
];
function harness(
  failCreate = false,
  override?: Projex.ProjexApi["Service"]["request"],
  readItem?: (id: string) => typeof raw,
  relationTypes?: unknown,
) {
  const calls: CodeupRequest[] = [];
  let current = { ...raw };
  const request: Projex.ProjexApi["Service"]["request"] = (r) =>
    Effect.gen(function* () {
      calls.push(r);
      if (
        override &&
        [
          "ProjexCreate",
          "ProjexRelations",
          "ProjexItemWorkflow",
          "ProjexProjects",
          "ProjexSearch",
        ].includes(r.operation)
      )
        return yield* override(r);
      switch (r.operation) {
        case "ProjexTypes":
          return [{ id: "type", name: "Task", categoryId: r.query?.category ?? "Task" }];
        case "ProjexMembers":
          return [{ userId: "viewer", userName: "Viewer" }];
        case "ProjexFields":
          return fields;
        case "ProjexWorkflow":
        case "ProjexItemWorkflow":
          return {
            statuses: [
              { id: "todo", name: "Todo" },
              { id: "done", name: "Done" },
            ],
          };
        case "ProjexRelationTypes":
          return (
            relationTypes ?? [
              { workitemTypeList: [{ id: "type", name: "Task", categoryId: "Task" }] },
            ]
          );
        case "ProjexRelations":
          return [];
        case "ProjexCreate":
          if (failCreate) return yield* new WorkItemError({ reason: "unavailable" });
          return { id: "item" };
        case "ProjexGet":
          return readItem?.(String(r.params?.id)) ?? current;
        case "ProjexUpdate":
          current = {
            ...current,
            subject: String(r.body?.subject ?? current.subject),
            gmtModified: current.gmtModified + 1,
          };
          return null;
        default:
          return yield* new WorkItemError({ reason: "unavailable" });
      }
    });
  const dependencies = Layer.mergeAll(
    Layer.succeed(Projex.ProjexApi, {
      request,
      account: () => Effect.succeed({ id: "viewer", name: "Viewer" }),
      organizations: Effect.succeed([]),
      verify: (_, account) =>
        account === "viewer"
          ? Effect.void
          : Effect.fail(new WorkItemError({ reason: "account-mismatch" })),
    }),
    Layer.mock(Environment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env")),
    }),
    Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        randomBytes: (size) => new Uint8Array(size),
        digest: (_, bytes) => Effect.succeed(bytes),
      }),
    ),
    SourceControlHost.layer({}),
  );
  return {
    calls,
    dependencies,
    setCreator: (id: string) => {
      current = { ...current, creator: { id } };
    },
  };
}
it.effect(
  "persists creation outcomes across service reconstruction and refuses different payload",
  () =>
    Effect.gen(function* () {
      const h = harness();
      const db = Receipts.layer.pipe(Layer.provide(Sqlite.layerMemory));
      yield* Effect.gen(function* () {
        const first = yield* Service.WorkItemsService.pipe(
          Effect.flatMap((s) => s.create(create)),
          Effect.provide(Service.layer.pipe(Layer.provide(h.dependencies))),
        );
        expect(first.itemId).toBe("item");
        const second = yield* Service.WorkItemsService.pipe(
          Effect.flatMap((s) => s.create(create)),
          Effect.provide(Service.layer.pipe(Layer.provide(h.dependencies))),
        );
        expect(second.itemId).toBe("item");
        const result = yield* Service.WorkItemsService.pipe(
          Effect.flatMap((s) =>
            s.create({ ...create, values: { ...create.values, subject: "Changed" } }),
          ),
          Effect.provide(Service.layer.pipe(Layer.provide(h.dependencies))),
          Effect.result,
        );
        expect(result._tag).toBe("Failure");
        expect(h.calls.filter((c) => c.operation === "ProjexCreate")).toHaveLength(1);
      }).pipe(Effect.provide(db));
    }),
);
it.effect("unknown and pre-reserved pending keys never post again", () =>
  Effect.gen(function* () {
    const h = harness(true);
    yield* Effect.gen(function* () {
      const s = yield* Service.WorkItemsService;
      expect((yield* s.create(create)).status).toBe("unknown");
      expect((yield* s.create(create)).status).toBe("unknown");
      expect(h.calls.filter((c) => c.operation === "ProjexCreate")).toHaveLength(1);
    }).pipe(
      Effect.provide(
        Service.layer.pipe(
          Layer.provide(h.dependencies),
          Layer.provide(Receipts.layer.pipe(Layer.provide(Sqlite.layerMemory))),
        ),
      ),
    );
  }),
);
it.effect(
  "rejects wrong viewer and old revisions before writing; updates only touched fields",
  () =>
    Effect.gen(function* () {
      const h = harness();
      yield* Effect.gen(function* () {
        const s = yield* Service.WorkItemsService;
        expect(
          (yield* s.create({ ...create, expectedAccountId: "other" }).pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect(h.calls).toHaveLength(0);
        expect(
          (yield* s
            .update({
              ...target,
              id: "item",
              expectedModified: 0,
              previous: { subject: "Title" },
              changes: { subject: "New" },
            })
            .pipe(Effect.result))._tag,
        ).toBe("Failure");
        expect(h.calls.some((c) => c.operation === "ProjexUpdate")).toBe(false);
        const changed = yield* s.update({
          ...target,
          id: "item",
          expectedModified: 1,
          previous: { subject: "Title" },
          changes: { subject: "New" },
        });
        expect(changed.values.description).toBe("Untouched");
        expect(h.calls.find((c) => c.operation === "ProjexUpdate")?.body).toEqual({
          subject: "New",
        });
      }).pipe(
        Effect.provide(
          Service.layer.pipe(
            Layer.provide(h.dependencies),
            Layer.provide(Receipts.layer.pipe(Layer.provide(Sqlite.layerMemory))),
          ),
        ),
      );
    }),
);
function serviceLayer(h: ReturnType<typeof harness>) {
  return Service.layer.pipe(
    Layer.provide(h.dependencies),
    Layer.provide(Receipts.layer.pipe(Layer.provide(Sqlite.layerMemory))),
  );
}
it.effect("serializes concurrent create while a platform request is in flight", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const h = harness(false, () =>
      Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.as({ id: "item" }),
      ),
    );
    yield* Effect.gen(function* () {
      const s = yield* Service.WorkItemsService;
      const first = yield* s.create(create).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const second = yield* s.create(create).pipe(Effect.forkChild);
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(first)).itemId).toBe("item");
      expect((yield* Fiber.join(second)).itemId).toBe("item");
      expect(h.calls.filter((c) => c.operation === "ProjexCreate")).toHaveLength(1);
    }).pipe(Effect.provide(serviceLayer(h)));
  }),
);
it.effect("a platform write followed by storage failure leaves pending and never posts again", () =>
  Effect.gen(function* () {
    const h = harness();
    yield* Effect.gen(function* () {
      const durable = yield* Receipts.WorkItemCreationReceiptRepository;
      const broken = Layer.succeed(Receipts.WorkItemCreationReceiptRepository, {
        ...durable,
        record: () => Effect.fail(new WorkItemError({ reason: "unavailable" })),
      });
      const layer = Service.layer.pipe(Layer.provide(h.dependencies), Layer.provide(broken));
      expect(
        (yield* Service.WorkItemsService.pipe(
          Effect.flatMap((s) => s.create(create)),
          Effect.provide(layer),
          Effect.result,
        ))._tag,
      ).toBe("Failure");
      const pending = yield* Service.WorkItemsService.pipe(
        Effect.flatMap((s) => s.create(create)),
        Effect.provide(layer),
      );
      expect(pending.status).toBe("pending");
      expect(h.calls.filter((c) => c.operation === "ProjexCreate")).toHaveLength(1);
    }).pipe(Effect.provide(Receipts.layer.pipe(Layer.provide(Sqlite.layerMemory))));
  }),
);
it.effect("recovery requires the original creator and matching values", () =>
  Effect.gen(function* () {
    const h = harness(true);
    yield* Effect.gen(function* () {
      const s = yield* Service.WorkItemsService;
      yield* s.create(create);
      h.setCreator("other");
      expect((yield* s.recover({ ...create, candidateId: "item" }).pipe(Effect.result))._tag).toBe(
        "Failure",
      );
      h.setCreator("viewer");
      expect((yield* s.recover({ ...create, candidateId: "item" })).status).toBe("created");
      expect(h.calls.filter((c) => c.operation === "ProjexCreate")).toHaveLength(1);
    }).pipe(Effect.provide(serviceLayer(h)));
  }),
);
it.effect(
  "invalid members and required fields fail before reserving or posting and permit correction",
  () =>
    Effect.gen(function* () {
      const h = harness();
      yield* Effect.gen(function* () {
        const s = yield* Service.WorkItemsService;
        for (const values of [
          { subject: "", assignedTo: "viewer" },
          { subject: "Title", assignedTo: "other" },
        ]) {
          expect((yield* s.create({ ...create, values }).pipe(Effect.result))._tag).toBe("Failure");
          expect((yield* s.receipt(create).pipe(Effect.result))._tag).toBe("Failure");
        }
        expect(h.calls.some((c) => c.operation === "ProjexCreate")).toBe(false);
        expect((yield* s.create(create)).status).toBe("created");
      }).pipe(Effect.provide(serviceLayer(h)));
    }),
);
it.effect("uses body pagination and rejects project/search windows above 10000", () =>
  Effect.gen(function* () {
    const h = harness(false, () => Effect.succeed([]));
    yield* Effect.gen(function* () {
      const s = yield* Service.WorkItemsService;
      yield* s.projects({ ...target, page: 2, perPage: 1 });
      yield* s.search({ ...target, category: "Task", page: 2, perPage: 1 });
      expect(h.calls.map((c) => ({ body: c.body, query: c.query }))).toEqual([
        { body: { page: 2, perPage: 1 }, query: undefined },
        { body: { page: 2, perPage: 1, spaceId: "space", category: "Task" }, query: undefined },
      ]);
      expect(
        (yield* s.projects({ ...target, page: 10001, perPage: 1 }).pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(
        (yield* s
          .search({ ...target, category: "Task", page: 10001, perPage: 1 })
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(h.calls).toHaveLength(2);
    }).pipe(Effect.provide(serviceLayer(h)));
  }),
);
it.effect("ready rejects empty and unknown mappings and checks every blocker workflow", () =>
  Effect.gen(function* () {
    const h = harness(false, (r) =>
      Effect.succeed(
        r.operation === "ProjexRelations"
          ? [{ id: "edge", resourceId: "item", resourceType: "Task" }]
          : {
              statuses: [
                { id: "todo", name: "Todo" },
                { id: "done", name: "Done" },
              ],
            },
      ),
    );
    yield* Effect.gen(function* () {
      const s = yield* Service.WorkItemsService;
      for (const terminalStatusIds of [[], ["unknown"], ["done", "unknown"]])
        expect(
          (yield* s.ready({ ...target, id: "root", terminalStatusIds }).pipe(Effect.result))._tag,
        ).toBe("Failure");
      expect((yield* s.ready({ ...target, id: "root", terminalStatusIds: ["done"] })).ready).toBe(
        false,
      );
      expect((yield* s.ready({ ...target, id: "root", terminalStatusIds: ["todo"] })).ready).toBe(
        true,
      );
    }).pipe(Effect.provide(serviceLayer(h)));
  }),
);
it.effect("a post-create readback validation error never reports create-not-submitted", () =>
  Effect.gen(function* () {
    const h = harness();
    const base = yield* Layer.build(h.dependencies);
    const api = Context.get(base, Projex.ProjexApi);
    const deps = Layer.merge(
      h.dependencies,
      Layer.succeed(Projex.ProjexApi, {
        ...api,
        request: (r) =>
          r.operation === "ProjexGet"
            ? Effect.succeed({ ...raw, space: { id: "moved" } })
            : api.request(r),
      }),
    );
    yield* Effect.gen(function* () {
      const s = yield* Service.WorkItemsService;
      const failed = yield* s.create(create).pipe(Effect.flip);
      expect(failed.reason).not.toBe("create-not-submitted");
      yield* s.create(create).pipe(Effect.result);
      expect(h.calls.filter((c) => c.operation === "ProjexCreate")).toHaveLength(1);
    }).pipe(
      Effect.provide(
        Service.layer.pipe(
          Layer.provide(deps),
          Layer.provide(Receipts.layer.pipe(Layer.provide(Sqlite.layerMemory))),
        ),
      ),
    );
  }).pipe(Effect.scoped),
);
it.effect("ready requires a completion mapping for each distinct blocker workflow", () =>
  Effect.gen(function* () {
    const h = harness(
      false,
      (r) =>
        Effect.succeed(
          r.operation === "ProjexRelations"
            ? [
                { id: "a", resourceId: "a", resourceType: "Task" },
                { id: "b", resourceId: "b", resourceType: "Bug" },
              ]
            : { statuses: [{ id: `done-${r.params?.id}`, name: "Done" }] },
        ),
      (id) => ({
        ...raw,
        id,
        workitemType: { id: `type-${id}` },
        status: { id: `done-${id}`, name: "Done" },
      }),
    );
    yield* Effect.gen(function* () {
      const s = yield* Service.WorkItemsService;
      expect(
        (yield* s
          .ready({ ...target, id: "root", terminalStatusIds: ["done-a"] })
          .pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(
        (yield* s.ready({ ...target, id: "root", terminalStatusIds: ["done-a", "done-b"] })).ready,
      ).toBe(true);
    }).pipe(Effect.provide(serviceLayer(h)));
  }),
);
it.effect(
  "loads full requirement metadata when ProjeX advertises feedback and topic relations",
  () =>
    Effect.gen(function* () {
      const h = harness(false, undefined, undefined, [
        {
          relationType: "DEPENDED_BY",
          workitemTypeList: [
            { id: "feedback", name: "Feedback", categoryId: "Request" },
            { id: "requirement", name: "Requirement", categoryId: "Req" },
            { id: "topic", name: "Topic", categoryId: "Topic" },
          ],
        },
      ]);
      yield* Effect.gen(function* () {
        const s = yield* Service.WorkItemsService;
        const metadata = yield* s.metadata({ ...target, category: "Req", typeId: "type" });
        expect(metadata.types[0]?.category).toBe("Req");
        expect(metadata.fields.length).toBeGreaterThan(0);
        expect(metadata.relationTypes).toHaveLength(4);
        for (const relation of metadata.relationTypes)
          expect(relation.types).toEqual([
            { id: "requirement", name: "Requirement", category: "Req" },
          ]);
        expect(h.calls.some((c) => c.operation === "ProjexCreate")).toBe(false);
        expect((yield* s.create(create)).status).toBe("created");
      }).pipe(Effect.provide(serviceLayer(h)));
    }),
);
