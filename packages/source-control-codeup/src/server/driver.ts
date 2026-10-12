import { defineSourceControlDriver } from "@t3tools/source-control-core/server/driver";
import { providerAuth } from "@t3tools/source-control-core/server/discovery";
import * as CodeupSourceControlProvider from "./CodeupSourceControlProvider.ts";
import * as CodeupPullRequestProvider from "./CodeupPullRequestProvider.ts";
import * as Effect from "effect/Effect";

import { definition } from "../client/definition.ts";
import { CODEUP_HOST } from "../client/repository.ts";
import * as CodeupApi from "./CodeupApi.ts";

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  make: Effect.gen(function* () {
    const api = yield* CodeupApi.CodeupApi;
    const sourceControl = yield* CodeupSourceControlProvider.make;
    const pullRequests = yield* CodeupPullRequestProvider.make;
    return {
      sourceControl,
      pullRequests,
      discovery: {
        type: "api" as const,
        kind: definition.kind,
        label: definition.label,
        installHint:
          "Uses the local aliyun-devops login or Yunxiao environment variables automatically. You can also add a token in Source Control settings.",
        probeAuth: api.probe.pipe(
          Effect.map((results) => {
            const failures = results.filter((result) => result.error !== null);
            const connected = results.length - failures.length;
            return providerAuth({
              status:
                connected > 0
                  ? "authenticated"
                  : results.length === 0 ||
                      failures.every(
                        (result) =>
                          result.error?.reason === "unauthenticated" ||
                          result.error?.reason === "not-configured",
                      )
                    ? "unauthenticated"
                    : "unknown",
              host: CODEUP_HOST,
              detail:
                results.length === 0
                  ? "Add an organization token in Source Control settings."
                  : `${connected} of ${results.length} organizations connected.${failures.length ? ` ${failures.map((result) => `${result.organizationId}: ${result.error?.message}`).join(" ")}` : ""}`,
            });
          }),
          Effect.catch((error) =>
            Effect.succeed(
              providerAuth({ status: "unknown", host: CODEUP_HOST, detail: error.message }),
            ),
          ),
        ),
      },
    };
  }),
});
