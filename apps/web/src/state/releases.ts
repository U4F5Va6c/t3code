import { useAtomValue } from "@effect/atom-react";
import {
  cliReleaseIndexPageUrl,
  hasCodeupReleaseAssets,
  newestCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import { CODEUP_PREVIEW, isCodeupPreviewVersion } from "@t3tools/shared/codeupPreview";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

const Release = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.optionalKey(Schema.Boolean),
  assets: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String }))),
});
const decodeRelease = Schema.decodeUnknownEffect(Release);
const decodeReleases = Schema.decodeUnknownEffect(Schema.Array(Release));

/**
 * Whether the matching release source has published an installable version.
 * A 404 is false; network errors stay unknown. Re-check every few minutes, so a release
 * that lands later shows up without a reload.
 */
const releasePublishedAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      const response = yield* HttpClient.get(
        isCodeupPreviewVersion(version)
          ? `https://api.github.com/repos/${CODEUP_PREVIEW.repository}/releases/tags/v${encodeURIComponent(version)}`
          : `https://registry.npmjs.org/t3/${encodeURIComponent(version)}`,
      );
      if (response.status === 404) return false;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      if (isCodeupPreviewVersion(version)) {
        const release = yield* decodeRelease(body);
        return (
          !release.draft && release.tag_name === `v${version}` && hasCodeupReleaseAssets(release)
        );
      }
      return typeof body === "object" && body !== null && "version" in body
        ? body.version === version
        : false;
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(Tracer.DisablePropagation, true),
    ),
  ).pipe(
    Atom.withRefresh("5 minutes"),
    Atom.keepAlive,
    Atom.withLabel(`release-published:${version}`),
  ),
);

const NO_VERSION_ATOM = Atom.make(AsyncResult.success(false)).pipe(
  Atom.withLabel("release-published:none"),
);

/** True only once its release source confirms the version, so callers can hide work that
    would download it until then. */
export function useReleasePublished(version: string | null): boolean {
  const result = useAtomValue(version ? releasePublishedAtom(version) : NO_VERSION_ATOM);
  return AsyncResult.getOrElse(result, () => false);
}

const codeupReleaseAtom = Atom.make(
  Effect.gen(function* () {
    const response = yield* HttpClient.get(cliReleaseIndexPageUrl(1, "codeup"));
    const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
      Effect.flatMap((ok) => ok.json),
    );
    const releases = yield* decodeReleases(body);
    return newestCliReleaseVersion(releases, "codeup") ?? null;
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(Tracer.DisablePropagation, true),
  ),
).pipe(Atom.withRefresh("5 minutes"), Atom.keepAlive);

const NO_CODEUP_RELEASE = Atom.make(AsyncResult.success<string | null>(null));

export function useCodeupReleaseVersion(enabled: boolean): string | null {
  return AsyncResult.getOrElse(
    useAtomValue(enabled ? codeupReleaseAtom : NO_CODEUP_RELEASE),
    () => null,
  );
}
