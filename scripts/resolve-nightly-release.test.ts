import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  resolveNightlyReleaseMetadata,
  resolveNightlyTargetVersion,
} from "./resolve-nightly-release.ts";

it.effect("derives Codeup versions from the same source baseline as nightly", () =>
  Effect.gen(function* () {
    const baseVersion = yield* resolveNightlyTargetVersion("0.0.45");
    const metadata = resolveNightlyReleaseMetadata(
      baseVersion,
      "20261012",
      15,
      "abcdef1234567890",
      "codeup",
    );
    assert.equal(metadata.version, "0.0.46-codeup.20261012.15");
    assert.equal(metadata.tag, "v0.0.46-codeup.20261012.15");
    assert.equal(metadata.name, "T3 Code Codeup Preview 0.0.46-codeup.20261012.15 (abcdef123456)");
  }),
);
