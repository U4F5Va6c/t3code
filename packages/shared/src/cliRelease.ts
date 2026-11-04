import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { CODEUP_PREVIEW, isCodeupPreviewVersion } from "./codeupPreview.ts";

import { compareSemverVersions } from "./semver.ts";

const CLI_RELEASE_REPOSITORY = "pingdotgg/t3code";
export const CLI_RELEASES_PAGE_URL = `https://github.com/${CLI_RELEASE_REPOSITORY}/releases`;
export const CLI_RELEASE_CHECKSUMS_FILE = "SHA256SUMS";
export const CLI_RELEASE_BASE_URL_ENV = "T3CODE_RELEASE_BASE_URL";

// Keep archive keys aligned with the Linux matrix, Windows ARM64 build, and cli_archive rows in release.yml.
// Node single-executables do not support darwin-x64 and segfault at startup.
const CLI_ARCHIVE_PLATFORM_KEYS = [
  "darwin-arm64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
] as const;
export type CliArchivePlatformKey = (typeof CLI_ARCHIVE_PLATFORM_KEYS)[number];

export function cliArchivePlatformKey(
  platform: NodeJS.Platform,
  arch: string,
): CliArchivePlatformKey | undefined {
  const key = `${platform}-${arch}`;
  return CLI_ARCHIVE_PLATFORM_KEYS.find((candidate) => candidate === key);
}

/** Use System32 bsdtar on Windows; Git-for-Windows GNU tar cannot open zip archives. */
export function cliArchiveTarCommand(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (platform !== "win32") return "tar";
  const systemRoot = env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows";
  return `${systemRoot}\\System32\\tar.exe`;
}

export function cliArchiveFileName(version: string, platformKey: CliArchivePlatformKey): string {
  return `t3-${version}-${platformKey}.${platformKey.startsWith("win32") ? "zip" : "tar.gz"}`;
}

/** Directory that `releases/download/<tag>/<asset>` lives under. */
export function cliReleaseDownloadBaseUrl(version: string, baseUrl?: string): string {
  const repository = isCodeupPreviewVersion(version)
    ? CODEUP_PREVIEW.repository
    : CLI_RELEASE_REPOSITORY;
  return `${(baseUrl?.trim() || `https://github.com/${repository}/releases/download`).replace(/\/+$/, "")}/v${version}`;
}

/** `segments` added to `baseUrl`'s path, keeping its query, such as a signed mirror URL's token. */
export function releaseAssetUrl(baseUrl: string, ...segments: ReadonlyArray<string>): string {
  const url = new URL(baseUrl);
  url.pathname = [url.pathname.replace(/\/+$/, ""), ...segments.map(encodeURIComponent)].join("/");
  return url.toString();
}

/** A file of release `version`, from `baseUrl` laid out as GitHub's release downloads. */
export function cliReleaseAssetUrl(version: string, fileName: string, baseUrl?: string): string {
  const repository = isCodeupPreviewVersion(version)
    ? CODEUP_PREVIEW.repository
    : CLI_RELEASE_REPOSITORY;
  return releaseAssetUrl(
    baseUrl?.trim() || `https://github.com/${repository}/releases/download`,
    `v${version}`,
    fileName,
  );
}

export function parseChecksums(text: string): ReadonlyMap<string, string> {
  const checksums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S.*)$/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      checksums.set(match[2], match[1].toLowerCase());
    }
  }
  return checksums;
}

export type CliReleaseChannel = "stable" | "nightly" | "preview" | "codeup";
export const CLI_RELEASE_CHANNELS: ReadonlyArray<CliReleaseChannel> = [
  "stable",
  "nightly",
  "preview",
  "codeup",
];

export function cliReleaseChannelOf(version: string): CliReleaseChannel {
  if (isCodeupPreviewVersion(version)) return "codeup";
  const channel = /^[^-+]+-(nightly|preview)\.\d{8}\.\d+$/.exec(version)?.[1];
  return channel === "nightly" || channel === "preview" ? channel : "stable";
}

/** Whether updating between these versions crosses Stable and Nightly. Preview builds cross nothing.
 * Hosts refuse a crossing outside a track switch, which checks the database first. */
export function crossesReleaseTrack(fromVersion: string, toVersion: string): boolean {
  const from = cliReleaseChannelOf(fromVersion);
  const to = cliReleaseChannelOf(toVersion);
  return from !== to && from !== "preview" && to !== "preview";
}

/** The desktop update track a build belongs to. Preview builds have no feed and read as Stable. */
export function desktopUpdateChannelOf(version: string): "latest" | "nightly" | "codeup" {
  if (isCodeupPreviewVersion(version)) return "codeup";
  return cliReleaseChannelOf(version) === "nightly" ? "nightly" : "latest";
}

/**
 * The update feed file a desktop app on this platform reads, which an update mirror publishes at
 * its root beside the release's CLI archives.
 */
export function updateFeedFileName(
  channel: "latest" | "nightly" | "codeup",
  platform: NodeJS.Platform,
  arch: string,
): string {
  if (platform === "darwin") return `${channel}-mac.yml`;
  if (platform === "linux")
    return arch === "arm64" ? `${channel}-linux-arm64.yml` : `${channel}-linux.yml`;
  return `${channel}.yml`;
}

/** Whether a track switch may install `found` after its database check cleared `checked`: any build
 * on the switch's track at least as new, since later releases only add migrations. */
export function acceptsTrackSwitchRelease(
  found: string,
  channel: "latest" | "nightly" | "codeup",
  checked: string,
): boolean {
  return (
    channel !== "codeup" &&
    cliReleaseChannelOf(found) === (channel === "nightly" ? "nightly" : "stable") &&
    compareSemverVersions(found, checked) >= 0
  );
}

/** Page until the channel matches; nightlies can push preview/stable releases past the first page. */
export function cliReleaseIndexPageUrl(page: number, channel?: CliReleaseChannel): string {
  const repository = channel === "codeup" ? CODEUP_PREVIEW.repository : CLI_RELEASE_REPOSITORY;
  return `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`;
}

/** Published last with the complete desktop/server asset set; old acceptance releases lack it. */
const CODEUP_RELEASE_MANIFEST = "codeup-release.json";

function hasCodeupReleaseAssets(release: {
  readonly assets?: ReadonlyArray<{ readonly name: string }> | undefined;
}): boolean {
  const names = new Set(release.assets?.map((asset) => asset.name));
  return (
    names.has(CODEUP_RELEASE_MANIFEST) &&
    names.has(CLI_RELEASE_CHECKSUMS_FILE) &&
    names.has("codeup-mac.yml")
  );
}

/** Draft assets are not downloadable. */
export function newestCliReleaseVersion(
  releases: ReadonlyArray<{
    readonly tag_name: string;
    readonly draft?: boolean | undefined;
    readonly assets?: ReadonlyArray<{ readonly name: string }> | undefined;
  }>,
  channel: CliReleaseChannel,
): string | undefined {
  for (const release of releases) {
    if (release.draft) continue;
    if (channel === "codeup" && !hasCodeupReleaseAssets(release)) continue;
    const version = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(release.tag_name)?.[1];
    if (version === undefined) continue;
    if (cliReleaseChannelOf(version) === channel) return version;
  }
  return undefined;
}

const NpmReleaseMigrationManifest = Schema.Struct({
  t3code: Schema.Struct({ databaseMigration: Schema.Int }),
});
const decodeNpmReleaseMigrationManifest = Schema.decodeUnknownOption(NpmReleaseMigrationManifest);

/** Highest database migration a release's server knows, from its npm `t3` manifest. */
export function npmReleaseDatabaseMigration(manifest: unknown): number | undefined {
  return Option.getOrUndefined(decodeNpmReleaseMigrationManifest(manifest))?.t3code
    .databaseMigration;
}
