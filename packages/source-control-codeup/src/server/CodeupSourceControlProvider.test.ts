import { describe, expect, it } from "@effect/vitest";
import * as TestHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Api from "./CodeupApi.ts";
import { definition } from "../client/definition.ts";
import * as Provider from "./CodeupSourceControlProvider.ts";

const repository = {
  id: 12,
  pathWithNamespace: "org/repo",
  defaultBranch: "main",
  webUrl: "https://codeup.aliyun.com/org/repo",
  sshUrlToRepo: "git@codeup.aliyun.com:org/repo.git",
  httpUrlToRepo: "https://codeup.aliyun.com/org/repo.git",
};
const mr = {
  localId: 7,
  title: "Feature",
  sourceBranch: "feature",
  targetBranch: "main",
  sourceProjectId: 12,
  targetProjectId: 12,
  author: null,
  reviewers: [],
  state: "UNDER_REVIEW",
  createdAt: "2026-10-12T00:00:00Z",
  updatedAt: "2026-10-12T00:00:00Z",
};
const input = {
  cwd: "/repo",
  context: {
    provider: { kind: definition.kind, name: "Codeup", baseUrl: "https://codeup.aliyun.com" },
    remoteName: "origin",
    remoteUrl: repository.sshUrlToRepo,
  },
  headSelector: "feature",
  baseRefName: "main",
  title: "Feature",
  bodyFile: "/body.md",
};

describe("Codeup MR creation", () => {
  it.effect.each(["existing", "accepted-before-timeout", "rejected"] as const)(
    "does not duplicate writes: %s",
    (scenario) => {
      const requests: Api.CodeupRequest[] = [];
      let attempted = false;
      const layer = Layer.mergeAll(
        TestHost.layer(),
        FileSystem.layerNoop({ readFileString: () => Effect.succeed("Description") }),
        Layer.succeed(Api.CodeupApi, {
          probe: Effect.succeed([]),
          getRepository: () => Effect.succeed(repository),
          request: (request) => {
            requests.push(request);
            if (request.operation === "ListChangeRequests") {
              expect(request.query?.projectIds).toBe(12);
              return Effect.succeed(
                scenario === "existing" || (attempted && scenario === "accepted-before-timeout")
                  ? [mr]
                  : [],
              );
            }
            attempted = true;
            return Effect.fail(new Api.CodeupApiError({ reason: "unavailable", status: null }));
          },
        }),
      );
      return Effect.gen(function* () {
        const provider = yield* Provider.make;
        const result = yield* provider.createChangeRequest(input).pipe(Effect.result);
        expect(result._tag).toBe(scenario === "rejected" ? "Failure" : "Success");
        expect(requests.filter((r) => r.operation === "CreateChangeRequest")).toHaveLength(
          scenario === "existing" ? 0 : 1,
        );
      }).pipe(Effect.provide(layer));
    },
  );
});
