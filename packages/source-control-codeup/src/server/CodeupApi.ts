import { PositiveInt, TrimmedNonEmptyString, TrimmedString } from "@t3tools/contracts";
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
  archived: Schema.optional(Schema.Boolean),
  defaultBranch: Schema.optional(Schema.NullOr(TrimmedString)),
});
const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

export class CodeupApiError extends Schema.TaggedError<CodeupApiError>()("CodeupApiError", {
  reason: Schema.Literals([
    "not-configured",
    "invalid-repository",
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
}

export class CodeupApi extends Context.Service<
  CodeupApi,
  {
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
    const saved = yield* tokens;
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
        ...Object.entries({ ...params, ...input.query, ...input.body }).flatMap(([key, value]) => [
          `--${flag(key)}`,
          typeof value === "object"
            ? JSON.stringify(value)
            : key === "repositoryId"
              ? encodeURIComponent(String(value))
              : String(value),
        ]),
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
          env: { ALIBABA_CLOUD_YUNXIAO_API_BASE_URL: CODEUP_API_HOST },
        });
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
      if (result.exitCode !== 0 || result.stdoutTruncated || result.stdoutInvalidUtf8)
        return yield* new CodeupApiError({ reason: "unavailable", status: null });
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
    if (response.status < 200 || response.status >= 300) {
      return yield* new CodeupApiError({
        status: response.status,
        reason:
          response.status === 401
            ? "unauthenticated"
            : response.status === 403
              ? "forbidden"
              : response.status === 404
                ? "not-found"
                : response.status === 429
                  ? "rate-limited"
                  : "unavailable",
      });
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

  return CodeupApi.of({
    request,
    getRepository: Effect.fn("CodeupApi.getRepository")(function* (input) {
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
            parseCodeupRepository(url)?.repository.toLowerCase() !==
            target.repository.toLowerCase(),
        ) ||
        !repository.webUrl.startsWith(`https://${CODEUP_HOST}/`)
      ) {
        return yield* new CodeupApiError({ reason: "invalid-response", status: null });
      }
      return repository;
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
