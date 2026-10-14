import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import { resolveNodeExecutable } from "@t3tools/shared/nodeRuntime";
import {
  type SourceControlRepositoryDirectoryInput,
  type SourceControlRepositoryDirectoryResult,
  type SourceControlRepositoryBranchesInput,
  type SourceControlRepositoryBranchesResult,
  SourceControlProviderKind,
  PositiveInt,
  TrimmedNonEmptyString,
  TrimmedString,
} from "@t3tools/contracts";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import { readSourceControlHostSettings } from "@t3tools/source-control-core/client/definition";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PlatformError from "effect/PlatformError";
import { operations } from "./operations.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as CodeupClient from "../client/definition.ts";
import { CODEUP_API_HOST, CODEUP_HOST, parseCodeupRepository } from "../client/repository.ts";

const Repository = Schema.Struct({
  id: PositiveInt,
  pathWithNamespace: TrimmedNonEmptyString,
  webUrl: TrimmedNonEmptyString,
  sshUrlToRepo: TrimmedNonEmptyString,
  httpUrlToRepo: TrimmedNonEmptyString,
  accessLevel: Schema.optional(
    Schema.NullOr(Schema.Union([Schema.Number, Schema.NumberFromString])),
  ),
  visibility: Schema.optional(Schema.Literals(["private", "internal", "public"])),
  archived: Schema.optional(Schema.Boolean),
  defaultBranch: Schema.optional(Schema.NullOr(TrimmedString)),
});
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

const httpFailure = (status: number | null) =>
  new CodeupApiError({
    status,
    reason:
      status === 401
        ? "unauthenticated"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not-found"
            : status === 429
              ? "rate-limited"
              : "unavailable",
  });

export class CodeupApiError extends Schema.TaggedError<CodeupApiError>()("CodeupApiError", {
  reason: Schema.Literals([
    "not-configured",
    "invalid-repository",
    "unsupported-host",
    "unauthenticated",
    "forbidden",
    "not-found",
    "rate-limited",
    "unavailable",
    "invalid-response",
  ]),
  status: Schema.NullOr(Schema.Int),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "not-configured":
        return "Sign in through aliyun-devops on this environment, set the Yunxiao token and organization environment variables, or add an organization token in Source Control settings.";
      case "unsupported-host":
        return "Repository browsing supports Codeup Central Edition at openapi-rdc.aliyuncs.com only.";
      case "invalid-repository":
        return "Use a Codeup Central Edition repository URL or full path beginning with its organization ID.";
      case "unauthenticated":
        return "Codeup rejected the token. Update it in Source Control settings.";
      case "forbidden":
        return "The Codeup token or organization membership does not grant access to this repository.";
      case "not-found":
        return "Codeup could not find this repository, or it is not visible to this account.";
      case "rate-limited":
        return "Codeup rate limited this request. Try again later.";
      case "invalid-response":
        return "Codeup returned an invalid response.";
      case "unavailable":
        return "Could not read Codeup. Check the server connection and try again.";
    }
  }
}

export interface CodeupRequest {
  readonly operation: keyof typeof operations;
  readonly organizationId?: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly query?: Readonly<Record<string, string | number>>;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly requireUnpaginated?: boolean;
}

export class CodeupApi extends Context.Service<
  CodeupApi,
  {
    readonly listRepositories: (
      input: SourceControlRepositoryDirectoryInput,
    ) => Effect.Effect<SourceControlRepositoryDirectoryResult, CodeupApiError>;
    readonly listBranches: (
      input: SourceControlRepositoryBranchesInput,
    ) => Effect.Effect<SourceControlRepositoryBranchesResult, CodeupApiError>;
    readonly request: (input: CodeupRequest) => Effect.Effect<unknown, CodeupApiError>;
    readonly getRepository: (
      repository: string,
    ) => Effect.Effect<typeof Repository.Type, CodeupApiError>;
    readonly probe: Effect.Effect<
      ReadonlyArray<{ readonly organizationId: string; readonly error: CodeupApiError | null }>,
      CodeupApiError
    >;
  }
>()("@t3tools/source-control-codeup/server/CodeupApi") {}

const make = Effect.gen(function* () {
  const fs = yield* Effect.serviceOption(FileSystem.FileSystem);
  const pathService = yield* Effect.serviceOption(Path.Path);
  const client = HttpClient.withScope(yield* HttpClient.HttpClient);
  const host = yield* SourceControlHost.SourceControlHost;
  const environment = yield* HostProcess.Environment;
  const workingDirectory = yield* HostProcess.WorkingDirectory;
  const tokens = host.settings.get.pipe(
    Effect.map(
      (settings) =>
        readSourceControlHostSettings(CodeupClient.settings, settings.sourceControlHosts.codeup)
          .organizationTokens,
    ),
    Effect.mapError(
      (cause) =>
        new CodeupApiError({ reason: "unavailable", status: null, cause: Redacted.make(cause) }),
    ),
  );

  const request = Effect.fn("CodeupApi.request")(function* (input: CodeupRequest) {
    const spec = operations[input.operation];
    const pinned = yield* PinnedCodeupTokens;
    const saved = pinned ?? (yield* tokens);
    const organizationId =
      input.organizationId ??
      Object.keys(saved)[0] ??
      environment.ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID;
    const savedToken =
      organizationId && Object.hasOwn(saved, organizationId)
        ? saved[organizationId]?.trim()
        : undefined;
    const apiHost = environment.ALIBABA_CLOUD_YUNXIAO_API_BASE_URL?.trim();
    const envToken =
      (!apiHost || apiHost === CODEUP_API_HOST || apiHost === `https://${CODEUP_API_HOST}`) &&
      (!organizationId || environment.ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID === organizationId)
        ? environment.ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN?.trim()
        : undefined;
    const token = savedToken || envToken;
    // A child CLI inherits the environment too; it must not reuse an explicitly scoped PAT
    // for a different organization just because the direct HTTP path rejected that scope.
    if (!token && environment.ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN?.trim())
      return yield* new CodeupApiError({ reason: "not-configured", status: null });
    const params = Object.fromEntries(
      Object.entries({ ...input.params, ...(organizationId ? { organizationId } : {}) }).filter(
        ([key]) => key === "organizationId" || spec.path.includes(`{${key}}`),
      ),
    );
    if (
      !token &&
      apiHost &&
      apiHost !== CODEUP_API_HOST &&
      apiHost !== `https://${CODEUP_API_HOST}`
    )
      return yield* new CodeupApiError({ reason: "not-configured", status: null });
    if (!token) {
      // The installed wrapper owns credential injection (including keychain prompts). Never
      // extract its PAT, evaluate a shell snippet, or read a deployment-specific secret file.
      const flag = (key: string) =>
        key
          .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
          .replaceAll("_", "-")
          .toLowerCase();
      const args = [
        spec.cli,
        ...Object.entries({
          ...params,
          ...input.query,
          ...(input.operation === "ProjexUpdate" ? { bizBody: input.body } : input.body),
        }).flatMap(([key, value]) =>
          input.operation === "ProjexCreate" && Array.isArray(value)
            ? [`--${flag(key)}`, ...value.map(String)]
            : [
                `--${flag(key)}`,
                typeof value === "object"
                  ? JSON.stringify(value)
                  : key === "repositoryId"
                    ? encodeURIComponent(String(value))
                    : String(value),
              ],
        ),
      ];
      const run = (command: string, prefix: ReadonlyArray<string>) =>
        host.process.run({
          operation: "CodeupApi.request",
          command,
          args: [...prefix, ...args],
          cwd: workingDirectory,
          spawnCwd: workingDirectory,
          timeoutMs: 30_000,
          maxOutputBytes: 8 * 1024 * 1024,
          allowNonZeroExit: true,
          env: { ALIBABA_CLOUD_YUNXIAO_API_BASE_URL: CODEUP_API_HOST },
        });
      if (input.operation === "ProjexItemWorkflow") {
        if (!organizationId || !input.params?.id) return yield* httpFailure(null);
        const node = yield* Effect.gen(function* () {
          if (!(yield* HostProcess.IsExecutable)) return yield* HostProcess.ExecutablePath;
          if (Option.isNone(fs) || Option.isNone(pathService))
            return yield* new CodeupApiError({ reason: "not-configured", status: null });
          return yield* resolveNodeExecutable("ProjeX workflow", environment).pipe(
            Effect.provideService(FileSystem.FileSystem, fs.value),
            Effect.provideService(Path.Path, pathService.value),
          );
        }).pipe(
          Effect.mapError(
            (cause) =>
              new CodeupApiError({
                reason: "not-configured",
                status: null,
                cause: Redacted.make(cause),
              }),
          ),
        );
        const result = yield* host.process
          .run({
            operation: "CodeupApi.projexWorkflow",
            command: "aliyun-devops",
            args: [
              "--exec",
              node,
              "--input-type=module",
              "-e",
              PROJEX_WORKFLOW_SCRIPT,
              organizationId,
              String(input.params.id),
            ],
            cwd: workingDirectory,
            spawnCwd: workingDirectory,
            timeoutMs: 30_000,
            maxOutputBytes: 8 * 1024 * 1024,
            allowNonZeroExit: true,
            env: { ALIBABA_CLOUD_YUNXIAO_API_BASE_URL: CODEUP_API_HOST },
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new CodeupApiError({
                  reason: "not-configured",
                  status: null,
                  cause: Redacted.make(cause),
                }),
            ),
          );
        if (result.exitCode !== 0 || result.stdoutTruncated || result.stdoutInvalidUtf8)
          return yield* httpFailure(null);
        return yield* decodeJson(result.stdout).pipe(
          Effect.mapError(
            (cause) =>
              new CodeupApiError({
                reason: "invalid-response",
                status: null,
                cause: Redacted.make(cause),
              }),
          ),
        );
      }
      const result = yield* run("aliyun-devops", []).pipe(
        Effect.catch((cause) =>
          cause._tag === "VcsProcessSpawnError" &&
          cause.cause instanceof PlatformError.PlatformError &&
          cause.cause.reason._tag === "NotFound"
            ? run("aliyun", ["devops"])
            : Effect.fail(cause),
        ),
        Effect.mapError(
          (cause) =>
            new CodeupApiError({
              reason: "not-configured",
              status: null,
              cause: Redacted.make(cause),
            }),
        ),
      );
      if (result.stdoutTruncated || result.stdoutInvalidUtf8) return yield* httpFailure(null);
      if (result.exitCode !== 0) {
        // Only an explicit SDK HTTP status can authorize creating after a failed lookup.
        const status =
          !result.stderrTruncated && !result.stderrInvalidUtf8
            ? result.stderr.match(
                /\bSDKError:\r?\n[ \t]+StatusCode:[ \t]+([45]\d{2})[ \t]*\r?$/mu,
              )?.[1]
            : undefined;
        return yield* httpFailure(status === undefined ? null : Number(status));
      }
      return yield* decodeJson(result.stdout.trim() || "null").pipe(
        Effect.mapError(
          (cause) =>
            new CodeupApiError({
              reason: "invalid-response",
              status: null,
              cause: Redacted.make(cause),
            }),
        ),
      );
    }
    let path: string = spec.path;
    for (const [key, value] of Object.entries(params))
      path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
    if (path.includes("{"))
      return yield* new CodeupApiError({ reason: "invalid-repository", status: null });
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input.query ?? {})) query.set(key, String(value));
    const httpRequest = HttpClientRequest.make(spec.method)(
      `https://${CODEUP_API_HOST}/oapi/v1${path}${query.size ? `?${query}` : ""}`,
    ).pipe(HttpClientRequest.setHeaders({ "x-yunxiao-token": token, accept: "application/json" }));
    const response = yield* client
      .execute(input.body ? HttpClientRequest.bodyJsonUnsafe(httpRequest, input.body) : httpRequest)
      .pipe(
        Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.timeout("15 seconds"),
        Effect.mapError(
          (cause) =>
            new CodeupApiError({
              reason: "unavailable",
              status: null,
              cause: Redacted.make(cause),
            }),
        ),
      );
    if (
      input.requireUnpaginated &&
      Object.keys(response.headers).some((key) =>
        /^x-(?:next-page|page|per-page|total|total-pages)$/i.test(key),
      )
    )
      return yield* new CodeupApiError({ reason: "invalid-response", status: response.status });
    if (response.status < 200 || response.status >= 300) {
      return yield* httpFailure(response.status);
    }
    const body = yield* collectUint8StreamText({
      stream: response.stream,
      maxBytes: 8 * 1024 * 1024,
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.mapError(
        (cause) =>
          new CodeupApiError({
            reason: "invalid-response",
            status: response.status,
            cause: Redacted.make(cause),
          }),
      ),
    );
    if (body.truncated || body.invalidUtf8)
      return yield* new CodeupApiError({ reason: "invalid-response", status: response.status });
    return yield* decodeJson(body.text.trim() || "null").pipe(
      Effect.mapError(
        (cause) =>
          new CodeupApiError({
            reason: "invalid-response",
            status: response.status,
            cause: Redacted.make(cause),
          }),
      ),
    );
  }, Effect.scoped);

  const getRepository = Effect.fn("CodeupApi.getRepository")(function* (input: string) {
    const target = parseCodeupRepository(input);
    if (!target) return yield* new CodeupApiError({ reason: "invalid-repository", status: null });
    const repository = yield* request({
      operation: "GetRepository",
      organizationId: target.organizationId,
      params: { repositoryId: target.repository },
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Repository)),
      Effect.mapError((cause) =>
        cause._tag === "CodeupApiError"
          ? cause
          : new CodeupApiError({
              reason: "invalid-response",
              status: null,
              cause: Redacted.make(cause),
            }),
      ),
    );
    // Never use a response for another organization/path, or hand Git an unrelated clone URL.
    if (
      repository.pathWithNamespace.toLowerCase() !== target.repository.toLowerCase() ||
      [repository.webUrl, repository.sshUrlToRepo, repository.httpUrlToRepo].some(
        (url) =>
          parseCodeupRepository(url)?.repository.toLowerCase() !== target.repository.toLowerCase(),
      ) ||
      !repository.webUrl.startsWith(`https://${CODEUP_HOST}/`)
    ) {
      return yield* new CodeupApiError({ reason: "invalid-response", status: null });
    }
    return repository;
  });
  const validateDirectory = (input: SourceControlRepositoryDirectoryInput) =>
    input.apiHost !== CODEUP_API_HOST
      ? Effect.fail(new CodeupApiError({ reason: "unsupported-host", status: null }))
      : /^[a-zA-Z0-9_-]+$/u.test(input.organizationId) &&
          Number.isSafeInteger(input.page) &&
          input.page >= 1 &&
          Number.isSafeInteger(input.perPage) &&
          input.perPage >= 1 &&
          input.perPage <= 100
        ? Effect.void
        : Effect.fail(new CodeupApiError({ reason: "invalid-repository", status: null }));
  const directoryRepository = (organizationId: string, repo: typeof Repository.Type) => ({
    provider: SourceControlProviderKind.make("codeup"),
    apiHost: CODEUP_API_HOST,
    organizationId,
    repositoryId: String(repo.id),
    nameWithOwner: repo.pathWithNamespace,
    webUrl: repo.webUrl,
    url: repo.httpUrlToRepo,
    sshUrl: repo.sshUrlToRepo,
    defaultBranch: repo.defaultBranch || null,
  });
  const decode = <S extends Schema.Codec<unknown, unknown, never, never>>(schema: S) =>
    Effect.flatMap((value: unknown) =>
      Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError(
          (cause) =>
            new CodeupApiError({
              reason: "invalid-response",
              status: null,
              cause: Redacted.make(cause),
            }),
        ),
      ),
    );
  return CodeupApi.of({
    request,
    getRepository,
    listRepositories: Effect.fn("CodeupApi.listRepositories")(function* (input) {
      yield* validateDirectory(input);
      const repositories = yield* request({
        operation: "ListRepositories",
        organizationId: input.organizationId,
        query: {
          page: input.page,
          perPage: input.perPage,
          ...(input.search ? { search: input.search } : {}),
        },
      }).pipe(decode(Schema.Array(Repository)));
      for (const repo of repositories) {
        const parsed = parseCodeupRepository(repo.pathWithNamespace);
        if (
          parsed?.organizationId !== input.organizationId ||
          !repo.webUrl.startsWith(`https://${CODEUP_HOST}/`) ||
          [repo.webUrl, repo.httpUrlToRepo, repo.sshUrlToRepo].some(
            (url) => parseCodeupRepository(url)?.repository !== repo.pathWithNamespace,
          )
        )
          return yield* new CodeupApiError({ reason: "invalid-response", status: null });
      }
      // shortcut: request discards pagination headers; a full page may lead to one final empty page until headers are exposed.
      return {
        repositories: repositories.map((repo) => directoryRepository(input.organizationId, repo)),
        nextPage: repositories.length === input.perPage ? input.page + 1 : null,
      };
    }),
    listBranches: Effect.fn("CodeupApi.listBranches")(function* (input) {
      yield* validateDirectory(input);
      if (parseCodeupRepository(input.repository)?.organizationId !== input.organizationId)
        return yield* new CodeupApiError({ reason: "invalid-repository", status: null });
      const repo = yield* getRepository(input.repository);
      if (String(repo.id) !== input.repositoryId)
        return yield* new CodeupApiError({ reason: "invalid-repository", status: null });
      const branches = yield* request({
        operation: "ListBranches",
        organizationId: input.organizationId,
        params: { repositoryId: repo.id },
        query: {
          page: input.page,
          perPage: input.perPage,
          ...(input.search ? { search: input.search } : {}),
        },
      }).pipe(
        decode(
          Schema.Array(
            Schema.Struct({
              name: TrimmedNonEmptyString,
              commit: Schema.Struct({ id: TrimmedNonEmptyString }),
              protected: Schema.Boolean,
            }),
          ),
        ),
      );
      return {
        repository: directoryRepository(input.organizationId, repo),
        branches: branches.map((branch) => ({
          name: branch.name,
          sha: branch.commit.id,
          protected: branch.protected,
        })),
        nextPage: branches.length === input.perPage ? input.page + 1 : null,
      };
    }),
    probe: tokens.pipe(
      Effect.flatMap((saved) =>
        Effect.forEach(
          Object.keys(saved).filter((key) => saved[key]?.trim()).length
            ? Object.keys(saved).filter((key) => saved[key]?.trim())
            : [environment.ALIBABA_CLOUD_YUNXIAO_ORGANIZATION_ID ?? ""],
          (organizationId) =>
            (organizationId
              ? request({
                  operation: "ListRepositories",
                  organizationId,
                  query: { page: 1, perPage: 1 },
                })
              : request({ operation: "GetUserByToken" })
            ).pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(
                  organizationId
                    ? Schema.Array(Schema.Struct({ id: PositiveInt }))
                    : Schema.Struct({ id: Schema.String }),
                ),
              ),
              Effect.as({ organizationId, error: null as CodeupApiError | null }),
              Effect.catch((cause) =>
                Effect.succeed({
                  organizationId,
                  error:
                    cause._tag === "CodeupApiError"
                      ? cause
                      : new CodeupApiError({
                          reason: "invalid-response",
                          status: null,
                          cause: Redacted.make(cause),
                        }),
                }),
              ),
            ),
          { concurrency: 4 },
        ),
      ),
    ),
  });
});

export const layer = Layer.effect(CodeupApi, make);

const PROJEX_WORKFLOW_SCRIPT = `
const [org, id] = process.argv.slice(1);
const token = process.env.ALIBABA_CLOUD_YUNXIAO_ACCESS_TOKEN;
if (!token || !org || !id) process.exit(2);
try {
 const response = await fetch("https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/" + encodeURIComponent(org) + "/workitems/" + encodeURIComponent(id) + "/workflow", {method:"GET",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"x-yunxiao-token":token,accept:"application/json"}});
 if (!response.ok || !response.body) process.exit(3);
 let size=0;const chunks=[];
 for await (const chunk of response.body) { size+=chunk.length;if(size>8388608)process.exit(4);chunks.push(chunk); }
 const text=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));JSON.parse(text);if(text.includes(token))process.exit(6);process.stdout.write(text);
} catch { process.exit(5); }
`;

const PinnedCodeupTokens = Context.Reference<Readonly<Record<string, string>> | null>(
  "CodeupApi/PinnedTokens",
  { defaultValue: () => null },
);

/** Snapshot configured credentials for a multi-step ProjeX operation; never return token values. */
export const withOrganizationCredential = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const host = yield* SourceControlHost.SourceControlHost;
    const settings = yield* host.settings.get;
    const tokens = readSourceControlHostSettings(
      CodeupClient.settings,
      settings.sourceControlHosts.codeup,
    ).organizationTokens;
    return yield* effect.pipe(Effect.provideService(PinnedCodeupTokens, tokens));
  });
