import type { DesktopUpdateChannel } from "@t3tools/contracts";
import { isCodeupPreviewVersion } from "@t3tools/shared/codeupPreview";

const NIGHTLY_VERSION_PATTERN = /^[^-+]+-nightly\.\d{8}\.\d+$/;
// Preview builds share nightly branding but ship without an update feed.
const PRERELEASE_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview|codeup)\.\d{8}\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return PRERELEASE_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  if (isCodeupPreviewVersion(appVersion)) return "codeup";
  return NIGHTLY_VERSION_PATTERN.test(appVersion) ? "nightly" : "latest";
}
