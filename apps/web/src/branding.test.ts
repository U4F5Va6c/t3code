import { describe, expect, it } from "vite-plus/test";
import {
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "./branding.logic";

describe("branding logic", () => {
  it("reuses the nightly backdrop while keeping the injected Codeup desktop name", () => {
    const primaryServerVersion = "0.0.46-codeup.20261012.15";
    expect(
      resolveServerBackedAppStageLabel({ primaryServerVersion, fallbackStageLabel: "Alpha" }),
    ).toBe("Nightly");
    expect(
      resolveServerBackedAppDisplayName({
        baseName: "T3 Code Codeup Preview",
        fallbackDisplayName: "T3 Code (Codeup Preview)",
        fallbackStageLabel: "Nightly",
        primaryServerVersion,
      }),
    ).toBe("T3 Code (Codeup Preview)");
  });
});
