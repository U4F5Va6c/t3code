import { describe, expect, it } from "vite-plus/test";

import { desktopUpdateChannelOf } from "@t3tools/shared/cliRelease";
import { isNightlyDesktopVersion } from "./updateChannels.ts";

describe("updateChannels", () => {
  it("keeps preview builds branded as nightly but on the latest update channel", () => {
    expect(isNightlyDesktopVersion("0.0.41-preview.20260911.7")).toBe(true);
    expect(desktopUpdateChannelOf("0.0.41-preview.20260911.7")).toBe("latest");
    expect(desktopUpdateChannelOf("0.0.41-nightly.20260911.7")).toBe("nightly");
    expect(isNightlyDesktopVersion("0.0.46-codeup.20261012.15")).toBe(true);
    expect(desktopUpdateChannelOf("0.0.46-codeup.20261012.15")).toBe("codeup");
  });
});
