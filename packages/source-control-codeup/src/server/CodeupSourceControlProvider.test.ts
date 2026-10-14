import { describe, expect, it } from "@effect/vitest";
import * as TestHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as HostProcess from "@t3tools/shared/HostProcess";
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
          listRepositories: () => Effect.die("unexpected directory call"),
          listBranches: () => Effect.die("unexpected branch call"),
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

describe("private repository publication retries", () => {
  it.effect.each(["absent", "forbidden", "unknown"] as const)(
    "uses CLI authentication to create only after confirmed absence: %s",
    (scenario) => {
      let exists = false;
      const writes: ReadonlyArray<string>[] = [];
      const host = Layer.mergeAll(
        FileSystem.layerNoop({}),
        TestHost.layer({
          process: {
            run: (input) => {
              expect(input.allowNonZeroExit).toBe(true);
              if (input.args[0] === "codeup-create-repository") {
                writes.push(input.args);
                exists = true;
              }
              return Effect.succeed(
                exists
                  ? TestHost.processOutput(
                      JSON.stringify({
                        ...repository,
                        visibility: "private",
                        accessLevel: "40",
                        archived: false,
                      }),
                    )
                  : TestHost.processOutput("", {
                      exitCode: ChildProcessSpawner.ExitCode(1),
                      stderr:
                        scenario === "unknown"
                          ? "Local error 404"
                          : `Error: SDKError:\n   StatusCode: ${scenario === "absent" ? 404 : 403}\n`,
                    }),
              );
            },
          },
        }),
      );
      const layer = Api.layer.pipe(
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("Unexpected HTTP authentication")),
          ),
        ),
        Layer.provideMerge(host),
        Layer.provide(Layer.succeed(HostProcess.Environment, {})),
      );
      return Effect.gen(function* () {
        const provider = yield* Provider.make;
        const publish = provider.createRepository({
          cwd: "/repo",
          repository: "org/repo",
          visibility: "private",
        });
        const result = yield* publish.pipe(Effect.result);
        expect(result._tag).toBe(scenario === "absent" ? "Success" : "Failure");
        if (scenario === "absent") {
          yield* publish;
          expect(writes).toHaveLength(1);
          expect(writes[0]).toEqual(
            expect.arrayContaining(["--visibility", "private", "--organization-id", "org"]),
          );
        } else expect(writes).toHaveLength(0);
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect.each(["existing", "accepted", "rejected", "public", "unknown"] as const)(
    "confirms identity and visibility before publishing: %s",
    (scenario) => {
      let exists = scenario === "existing" || scenario === "public" || scenario === "unknown";
      let writes = 0;
      const layer = Layer.mergeAll(
        TestHost.layer(),
        FileSystem.layerNoop({}),
        Layer.mock(Api.CodeupApi)({
          getRepository: () =>
            exists
              ? Effect.succeed({
                  ...repository,
                  accessLevel: 40,
                  ...(scenario === "unknown"
                    ? {}
                    : {
                        visibility:
                          scenario === "public" ? ("public" as const) : ("private" as const),
                      }),
                })
              : Effect.fail(new Api.CodeupApiError({ reason: "not-found", status: 404 })),
          request: () =>
            Effect.sync(() => {
              writes++;
              exists = scenario === "accepted";
            }).pipe(
              Effect.andThen(
                Effect.fail(new Api.CodeupApiError({ reason: "unavailable", status: null })),
              ),
            ),
        }),
      );
      return Effect.gen(function* () {
        const provider = yield* Provider.make;
        const publish = provider.createRepository({
          cwd: "/repo",
          repository: "org/repo",
          visibility: "private",
        });
        const result = yield* publish.pipe(Effect.result);
        expect(result._tag).toBe(
          scenario === "existing" || scenario === "accepted" ? "Success" : "Failure",
        );
        if (result._tag === "Success") {
          yield* publish;
          expect(writes).toBe(scenario === "existing" ? 0 : 1);
        }
        if (scenario === "public" || scenario === "unknown") expect(writes).toBe(0);
      }).pipe(Effect.provide(layer));
    },
  );
});
