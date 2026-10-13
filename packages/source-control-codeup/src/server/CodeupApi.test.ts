import { describe, expect, it } from "@effect/vitest";
import { SourceControlProviderKind, DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PlatformError from "effect/PlatformError";
import { VcsProcessSpawnError, VcsProcessExitError } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as CodeupApi from "./CodeupApi.ts";
import { driver } from "./driver.ts";

const repository = (path = "org-a/team/repo") => ({
  id: 123,
  pathWithNamespace: path,
  defaultBranch: "develop",
  webUrl: `https://codeup.aliyun.com/${path}`,
  httpUrlToRepo: `https://codeup.aliyun.com/${path}.git`,
  sshUrlToRepo: `git@codeup.aliyun.com:${path}.git`,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function harness(
  respond: (request: HttpClientRequest.HttpClientRequest) => Response = () => json(repository()),
) {
  const sent: Array<{ url: string; token: string | undefined; redirect: string | undefined }> = [];
  const signals: AbortSignal[] = [];
  const http = HttpClient.make((request, _url, _signal, fiber) => {
    signals.push(_signal);
    sent.push({
      url: request.url,
      token: request.headers["x-yunxiao-token"],
      redirect: Context.getOrUndefined(fiber.context, FetchHttpClient.RequestInit)?.redirect,
    });
    return Effect.succeed(HttpClientResponse.fromWeb(request, respond(request)));
  });
  const layer = CodeupApi.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
    Layer.provideMerge(
      TestSourceControlHost.layer({
        process: {
          run: () =>
            Effect.fail(
              new VcsProcessExitError({
                command: "aliyun-devops",
                exitCode: 1,
                detail: "not configured",
                cwd: "/tmp",
                operation: "CodeupApi.request",
              }),
            ),
        },
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          sourceControlHosts: {
            codeup: { organizationTokens: { "org-a": "token-a", "org-b": "token-b" } },
          },
        },
      }),
    ),
  );
  return {
    layer: layer.pipe(
      Layer.provideMerge(FileSystem.layerNoop({})),
      Layer.provide(Layer.succeed(HostProcess.Environment, {})),
    ),
    sent,
    signals,
  };
}

describe("Codeup API and driver", () => {
  it.effect("routes only to the fixed API host with the matching organization's token", () => {
    const { layer, sent } = harness((request) =>
      json(repository(request.url.includes("/org-b/") ? "org-b/team/repo" : undefined)),
    );
    return Effect.gen(function* () {
      const api = yield* CodeupApi.CodeupApi;
      yield* api.getRepository("git@codeup.aliyun.com:org-a/team/repo.git");
      yield* api.getRepository("org-b/team/repo");
      expect(sent).toEqual([
        {
          url: "https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/org-a/repositories/org-a%2Fteam%2Frepo",
          token: "token-a",
          redirect: "manual",
        },
        {
          url: "https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/org-b/repositories/org-b%2Fteam%2Frepo",
          token: "token-b",
          redirect: "manual",
        },
      ]);
      const missing = yield* api.getRepository("org-c/team/repo").pipe(Effect.flip);
      expect(missing.reason).toBe("not-configured");
      expect(
        (yield* api.getRepository("https://evil.test/org-a/repo").pipe(Effect.flip)).reason,
      ).toBe("invalid-repository");
      expect(sent).toHaveLength(2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("applies replacement, removal, and reconnection without a stale credential", () => {
    const { layer, sent } = harness();
    return Effect.gen(function* () {
      const api = yield* CodeupApi.CodeupApi;
      const settings = yield* TestSourceControlHost.TestSourceControlHostSettings;
      yield* api.getRepository("org-a/team/repo");
      yield* settings.update({
        sourceControlHosts: { codeup: { organizationTokens: { "org-a": "replacement" } } },
      });
      yield* api.getRepository("org-a/team/repo");
      yield* settings.update({ sourceControlHosts: { codeup: { organizationTokens: {} } } });
      expect((yield* api.getRepository("org-a/team/repo").pipe(Effect.flip)).reason).toBe(
        "not-configured",
      );
      expect((yield* api.probe)[0]?.error?.reason).toBe("not-configured");
      yield* settings.update({
        sourceControlHosts: { codeup: { organizationTokens: { "org-a": "reconnected" } } },
      });
      yield* api.getRepository("org-a/team/repo");
      expect(sent.map((request) => request.token)).toEqual([
        "token-a",
        "replacement",
        "reconnected",
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not-found"],
    [429, "rate-limited"],
    [503, "unavailable"],
    [302, "unavailable"],
  ] as const)("reports HTTP %s without leaking or retrying its body", ([status, reason]) => {
    const { layer, sent, signals } = harness(() =>
      json({ message: "private-error-body token-a" }, status),
    );
    return Effect.gen(function* () {
      const error = yield* (yield* CodeupApi.CodeupApi)
        .getRepository("org-a/team/repo")
        .pipe(Effect.flip);
      expect(error.reason).toBe(reason);
      expect(error.status).toBe(status);
      expect(JSON.stringify(error)).not.toContain("private-error-body");
      expect(sent).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(true);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects responses belonging to another repository and foreign clone URLs", () => {
    const { layer } = harness(() =>
      json({ ...repository(), sshUrlToRepo: "git@evil.test:org-a/team/repo.git" }),
    );
    return Effect.gen(function* () {
      const api = yield* CodeupApi.CodeupApi;
      expect((yield* api.getRepository("org-a/team/repo").pipe(Effect.flip)).reason).toBe(
        "invalid-response",
      );
      expect((yield* api.getRepository("org-b/team/repo").pipe(Effect.flip)).reason).toBe(
        "invalid-response",
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("bounds repository payloads", () => {
    const { layer } = harness(() => new Response("x".repeat(2 * 1024 * 1024 + 1)));
    return Effect.gen(function* () {
      const error = yield* (yield* CodeupApi.CodeupApi)
        .getRepository("org-a/team/repo")
        .pipe(Effect.flip);
      expect(error.reason).toBe("invalid-response");
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "rejects malformed JSON and allows an empty repository's missing default branch",
    () => {
      let malformed = true;
      const { layer } = harness(() =>
        malformed ? new Response("{") : json({ ...repository(), defaultBranch: "" }),
      );
      return Effect.gen(function* () {
        const api = yield* CodeupApi.CodeupApi;
        expect((yield* api.getRepository("org-a/team/repo").pipe(Effect.flip)).reason).toBe(
          "invalid-response",
        );
        malformed = false;
        const instance = yield* driver.make;
        expect(
          yield* instance.sourceControl.getDefaultBranch({
            cwd: "/repo",
            context: {
              provider: { kind: driver.kind, name: "Codeup", baseUrl: "https://codeup.aliyun.com" },
              remoteName: "origin",
              remoteUrl: "git@codeup.aliyun.com:org-a/team/repo.git",
            },
          }),
        ).toBeNull();
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("keeps a transport error's credential out of serialized failures", () => {
    const http = HttpClient.make((request) =>
      Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request, cause: "offline" }),
        }),
      ),
    );
    const layer = CodeupApi.layer.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
      Layer.provide(
        TestSourceControlHost.layer({
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            sourceControlHosts: {
              codeup: { organizationTokens: { "org-a": "private-pat-value" } },
            },
          },
        }),
      ),
    );
    return Effect.gen(function* () {
      const error = yield* (yield* CodeupApi.CodeupApi)
        .getRepository("org-a/team/repo")
        .pipe(Effect.flip);
      expect(error.reason).toBe("unavailable");
      expect(JSON.stringify(error)).not.toContain("private-pat-value");
      const directoryError = yield* (yield* CodeupApi.CodeupApi)
        .listRepositories(directoryInput)
        .pipe(Effect.flip);
      expect(directoryError.reason).toBe("unavailable");
      expect(JSON.stringify(directoryError)).not.toContain("private-pat-value");
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "exposes the verified clone URLs and default branch through the registered driver",
    () => {
      const { layer, sent } = harness();
      return Effect.gen(function* () {
        const instance = yield* driver.make;
        expect(
          yield* instance.sourceControl.getRepositoryCloneUrls({
            cwd: "/repo",
            repository: "org-a/team/repo",
          }),
        ).toEqual({
          nameWithOwner: "org-a/team/repo",
          url: "https://codeup.aliyun.com/org-a/team/repo.git",
          sshUrl: "git@codeup.aliyun.com:org-a/team/repo.git",
        });
        expect(
          yield* instance.sourceControl.getDefaultBranch({
            cwd: "/repo",
            context: {
              provider: { kind: driver.kind, name: "Codeup", baseUrl: "https://codeup.aliyun.com" },
              remoteName: "upstream",
              remoteUrl: "git@codeup.aliyun.com:org-a/team/repo.git",
            },
          }),
        ).toBe("develop");
        expect(instance.pullRequests?.capabilities.diff).toBe(true);
        expect(
          (yield* instance.sourceControl
            .createRepository({ cwd: "/repo", repository: "org-a/new", visibility: "public" })
            .pipe(Effect.flip)).detail,
        ).toContain("private repository");
        expect(sent).toHaveLength(2);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("probes each organization independently and preserves partial failures", () => {
    const { layer } = harness((request) =>
      request.url.includes("/org-a/") ? json([{ id: 123 }]) : json({}, 403),
    );
    return Effect.gen(function* () {
      const instance = yield* driver.make;
      if (instance.discovery.type !== "api") throw new Error("Expected API discovery");
      const auth = yield* instance.discovery.probeAuth;
      expect(auth.status).toBe("authenticated");
      expect(auth.detail).toMatchObject({
        value: expect.stringContaining("1 of 2 organizations connected"),
      });
      expect(auth.detail).toMatchObject({ value: expect.stringContaining("org-b:") });
    }).pipe(Effect.provide(layer));
  });
});

describe("Codeup automatic authentication", () => {
  const automatic = (
    environment: NodeJS.ProcessEnv,
    missingWrapper = false,
    failedWrapper = false,
  ) => {
    const calls: Array<{ command: string; args: ReadonlyArray<string>; env?: NodeJS.ProcessEnv }> =
      [];
    const sent: Array<string | undefined> = [];
    const http = HttpClient.make((request) => {
      sent.push(request.headers["x-yunxiao-token"]);
      return Effect.succeed(HttpClientResponse.fromWeb(request, json(repository())));
    });
    const layer = CodeupApi.layer.pipe(
      Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
      Layer.provide(
        TestSourceControlHost.layer({
          process: {
            run: (input) => {
              calls.push(input);
              if (input.command === "aliyun-devops" && missingWrapper)
                return Effect.fail(
                  new VcsProcessSpawnError({
                    operation: input.operation,
                    command: input.command,
                    cwd: input.cwd,
                    cause: PlatformError.systemError({
                      _tag: "NotFound",
                      module: "ChildProcess",
                      method: "spawn",
                    }),
                  }),
                );
              if (failedWrapper)
                return Effect.fail(
                  new VcsProcessExitError({
                    operation: input.operation,
                    command: input.command,
                    cwd: input.cwd,
                    exitCode: 1,
                    detail: "private stderr",
                  }),
                );
              return Effect.succeed(
                TestSourceControlHost.processOutput(JSON.stringify(repository())),
              );
            },
          },
        }),
      ),
      Layer.provide(Layer.succeed(HostProcess.Environment, environment)),
    );
    return { layer, calls, sent };
  };
  it.effect.each([false, true])(
    "uses a credential wrapper, with CLI fallback only when missing: %s",
    (missing) => {
      const { layer, calls, sent } = automatic({}, missing);
      return Effect.gen(function* () {
        yield* (yield* CodeupApi.CodeupApi).getRepository("org-a/team/repo");
        expect(calls.map((c) => c.command)).toEqual(
          missing ? ["aliyun-devops", "aliyun"] : ["aliyun-devops"],
        );
        expect(calls.at(-1)?.args).toContain("org-a%2Fteam%2Frepo");
        expect(calls.at(-1)?.env).toEqual({
          ALIBABA_CLOUD_YUNXIAO_API_BASE_URL: "openapi-rdc.aliyuncs.com",
        });
        expect(sent).toHaveLength(0);
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect("does not retry a failing credential wrapper with another account", () => {
    const { layer, calls } = automatic({}, false, true);
    return Effect.gen(function* () {
      const error = yield* (yield* CodeupApi.CodeupApi)
        .getRepository("org-a/team/repo")
        .pipe(Effect.flip);
      expect(calls).toHaveLength(1);
      expect(JSON.stringify(error)).not.toContain("private stderr");
    }).pipe(Effect.provide(layer));
  });
  it.effect("uses the environment PAT only for its configured organization", () => {
    const { layer, calls, sent } = automatic({
      ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN: "env-pat",
      ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID: "org-a",
    });
    return Effect.gen(function* () {
      const api = yield* CodeupApi.CodeupApi;
      yield* api.getRepository("org-a/team/repo");
      expect(
        (yield* api
          .request({
            operation: "GetRepository",
            organizationId: "org-b",
            params: { repositoryId: "org-b/repo" },
          })
          .pipe(Effect.asVoid, Effect.flip)).reason,
      ).toBe("not-configured");
      expect(sent).toEqual(["env-pat"]);
      expect(calls).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });
  it.effect("does not redirect credentials from another deployment into Central Edition", () => {
    const { layer, calls, sent } = automatic({
      ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN: "other-pat",
      ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID: "org-a",
      ALIBABA_CLOUD_YUNXIAO_API_BASE_URL: "https://private.example",
    });
    return Effect.gen(function* () {
      expect(
        (yield* (yield* CodeupApi.CodeupApi).getRepository("org-a/team/repo").pipe(Effect.flip))
          .reason,
      ).toBe("not-configured");
      expect(sent).toHaveLength(0);
      expect(calls).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });
});

const directoryInput = {
  provider: SourceControlProviderKind.make("codeup"),
  apiHost: "openapi-rdc.aliyuncs.com",
  organizationId: "org-a",
  page: 1,
  perPage: 2,
};
describe("Codeup repository directory", () => {
  it.effect.each([
    { page: 0, perPage: 20 },
    { page: 1, perPage: 101 },
    { page: 1.5, perPage: 20 },
    { page: 1, perPage: 0 },
  ])("rejects invalid page bounds before HTTP: %s", (bounds) => {
    const { layer, sent } = harness();
    return Effect.gen(function* () {
      const api = yield* CodeupApi.CodeupApi;
      expect(
        (yield* api.listRepositories({ ...directoryInput, ...bounds }).pipe(Effect.flip)).reason,
      ).toBe("invalid-repository");
      expect(sent).toHaveLength(0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("reads only the requested page and preserves nested same-name repositories", () => {
    const { layer, sent } = harness((request) =>
      json(
        request.url.includes("page=2")
          ? []
          : [
              repository("org-a/team/repo"),
              { ...repository("org-a/other/repo"), id: 124, defaultBranch: undefined },
            ],
      ),
    );
    return Effect.gen(function* () {
      const api = yield* CodeupApi.CodeupApi;
      const first = yield* api.listRepositories({ ...directoryInput, search: "repo" });
      expect(first.nextPage).toBe(2);
      expect(
        first.repositories.map((r) => [r.repositoryId, r.nameWithOwner, r.defaultBranch]),
      ).toEqual([
        ["123", "org-a/team/repo", "develop"],
        ["124", "org-a/other/repo", null],
      ]);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toContain("page=1&perPage=2&search=repo");
      expect(yield* api.listRepositories({ ...directoryInput, page: 2 })).toEqual({
        repositories: [],
        nextPage: null,
      });
    }).pipe(Effect.provide(layer));
  });
  it.effect(
    "rejects unsupported hosts and mismatched organization paths before sending credentials",
    () => {
      const { layer, sent } = harness();
      return Effect.gen(function* () {
        const api = yield* CodeupApi.CodeupApi;
        expect(
          (yield* api
            .listRepositories({ ...directoryInput, apiHost: "private.example" })
            .pipe(Effect.flip)).reason,
        ).toBe("unsupported-host");
        expect(
          (yield* api
            .listBranches({ ...directoryInput, repository: "org-b/repo", repositoryId: "123" })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid-repository");
        expect(sent).toHaveLength(0);
      }).pipe(Effect.provide(layer));
    },
  );
  it.effect("rejects response organization mismatch", () => {
    const { layer } = harness(() => json([repository("org-b/team/repo")]));
    return Effect.gen(function* () {
      const api = yield* CodeupApi.CodeupApi;
      expect((yield* api.listRepositories(directoryInput).pipe(Effect.flip)).reason).toBe(
        "invalid-response",
      );
    }).pipe(Effect.provide(layer));
  });
  it.effect("verifies repository ID and reads paged SHAs and the actual default branch", () => {
    const { layer, sent } = harness((request) =>
      json(
        request.url.includes("/branches")
          ? [
              { name: "develop", commit: { id: "abcdef" }, protected: true },
              { name: "feature", commit: { id: "fedcba" }, protected: false },
            ]
          : repository(),
      ),
    );
    return Effect.gen(function* () {
      const api = yield* CodeupApi.CodeupApi;
      const input = { ...directoryInput, repository: "org-a/team/repo", repositoryId: "123" };
      const result = yield* api.listBranches(input);
      expect(result.repository.defaultBranch).toBe("develop");
      expect(result.branches[0]).toEqual({ name: "develop", sha: "abcdef", protected: true });
      expect(result.nextPage).toBe(2);
      expect(sent[1]?.url).toContain("/repositories/123/branches?page=1&perPage=2");
      expect(
        (yield* api.listBranches({ ...input, repositoryId: "999" }).pipe(Effect.flip)).reason,
      ).toBe("invalid-repository");
      expect(sent).toHaveLength(3);
    }).pipe(Effect.provide(layer));
  });
  it.effect.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not-found"],
    [429, "rate-limited"],
  ] as const)("preserves API status %s as %s", ([status, reason]) => {
    const { layer } = harness(() => json({}, status));
    return Effect.gen(function* () {
      const api = yield* CodeupApi.CodeupApi;
      expect((yield* api.listRepositories(directoryInput).pipe(Effect.flip)).reason).toBe(reason);
    }).pipe(Effect.provide(layer));
  });
});
