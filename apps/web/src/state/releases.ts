import { cliReleaseIndexPageUrl, newestCliReleaseVersion } from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { Atom } from "effect/reactivity";

import { useEnvironmentQuery } from "./query";

const decodeReleases = Schema.decodeUnknownEffect(
  Schema.Array(
    Schema.Struct({
      tag_name: Schema.String,
      draft: Schema.optionalKey(Schema.Boolean),
      assets: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
    }),
  ),
);

export const codeupReleaseAtom = Atom.make(
  Effect.gen(function* () {
    const response = yield* HttpClient.get(cliReleaseIndexPageUrl(1, "codeup"));
    const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap((ok) => ok.json),
    );
    const releases = yield* decodeReleases(body);
    return newestCliReleaseVersion(releases, "codeup") ?? null;
  }).pipe(
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.provide(FetchHttpClient.layer),
  ),
).pipe(Atom.withRefresh("5 minutes"), Atom.keepAlive);

export function useCodeupReleaseVersion(enabled: boolean) {
  return useEnvironmentQuery(enabled ? codeupReleaseAtom : null);
}
