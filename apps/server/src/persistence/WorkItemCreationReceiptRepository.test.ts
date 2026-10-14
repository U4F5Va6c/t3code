import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Repository from "./WorkItemCreationReceiptRepository.ts";
import * as Sqlite from "./Sqlite.ts";
const key = {
  environmentId: "env",
  organizationId: "org",
  viewer: "viewer",
  clientRequestId: "id",
};
const value = { spaceId: "space", typeId: "type", payloadHash: "hash" };
it.effect("atomically reserves once and isolates environment, organization and viewer", () =>
  Effect.gen(function* () {
    const repo = yield* Repository.WorkItemCreationReceiptRepository;
    const results = yield* Effect.all([repo.reserve(key, value), repo.reserve(key, value)], {
      concurrency: "unbounded",
    });
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((yield* repo.get(key))?.status).toBe("pending");
    for (const alternate of [
      { ...key, environmentId: "other" },
      { ...key, organizationId: "other" },
      { ...key, viewer: "other" },
    ])
      expect(yield* repo.reserve(alternate, value)).toBe(true);
    yield* repo.record(key, "item");
    yield* repo.record(key, null);
    expect((yield* repo.get(key))?.itemId).toBe("item");
  }).pipe(Effect.provide(Repository.layer.pipe(Layer.provide(Sqlite.layerMemory)))),
);
