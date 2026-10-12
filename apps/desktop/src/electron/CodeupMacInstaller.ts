// @effect-diagnostics nodeBuiltinImport:off -- This Electron boundary stages a native bundle and detaches an installer that must outlive the app's Effect scopes.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { CODEUP_PREVIEW, isCodeupPreviewVersion } from "@t3tools/shared/codeupPreview";
import { compareSemverVersions, parseSemver } from "@t3tools/shared/semver";
import * as Schema from "effect/Schema";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);
const Download = Schema.Struct({
  version: Schema.String,
  downloadedFile: Schema.String,
  files: Schema.Array(Schema.Struct({ url: Schema.String, sha512: Schema.String })),
});

const decodeDownload = Schema.decodeUnknownSync(Download);

export class CodeupMacInstallError extends Error {}

// Arguments, never interpolated shell source: paths can contain spaces or shell metacharacters.
const CODEUP_MAC_INSTALL_SCRIPT = `#!/bin/sh
set -eu
parent_pid="$1"
app="$2"
staged="$3"
backup="$4"
work="$5"
lock="$6"
trap '/bin/rmdir "$lock" 2>/dev/null || true' EXIT
attempt=0
while /bin/kill -0 "$parent_pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo 'The app did not quit; no application was replaced.'
    exit 1
  fi
  /bin/sleep 1
done
restore() {
  echo 'Installation failed; restoring the previous app.'
  if [ -d "$backup" ]; then
    if [ -e "$app" ]; then /bin/mv "$app" "$work/failed.app"; fi
    /bin/mv "$backup" "$app"
  fi
  /usr/bin/open -n "$app" || true
  /usr/bin/osascript -e 'display alert "Codeup Preview update failed" message "The previous app was restored. Download the latest DMG from the Codeup release page and try again."' || true
  exit 1
}
/bin/mv "$app" "$backup" || restore
/bin/mv "$staged" "$app" || restore
/usr/bin/open -n "$app" || restore
/bin/rm -rf "$work"
`;

async function bundleValue(appPath: string, key: string): Promise<string> {
  const { stdout } = await execute("/usr/libexec/PlistBuddy", [
    "-c",
    `Print ${key}`,
    NodePath.join(appPath, "Contents", "Info.plist"),
  ]);
  return stdout.trim();
}

async function requirePreviewBundle(appPath: string): Promise<void> {
  if (
    (await NodeFSP.lstat(appPath)).isSymbolicLink() ||
    (await bundleValue(appPath, "CFBundleIdentifier")) !== CODEUP_PREVIEW.appId
  ) {
    throw new CodeupMacInstallError("The selected application is not Codeup Preview.");
  }
}

/** Stage and verify everything before the running app is asked to quit. */
export async function prepareCodeupMacInstall(input: {
  readonly executable: string;
  readonly currentVersion: string;
  readonly architecture: string;
  readonly download: unknown;
}) {
  let step = "reading the downloaded update";
  let work: string | undefined;
  let lock: string | undefined;
  try {
    const download = decodeDownload(input.download);
    const appPath = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(input.executable)?.[1];
    if (
      !appPath ||
      !NodePath.isAbsolute(appPath) ||
      appPath.startsWith("/Volumes/") ||
      appPath.includes("/AppTranslocation/")
    ) {
      throw new CodeupMacInstallError(
        "Move Codeup Preview to a writable Applications folder before updating.",
      );
    }
    if (
      !parseSemver(input.currentVersion) ||
      !parseSemver(download.version) ||
      !isCodeupPreviewVersion(input.currentVersion) ||
      !isCodeupPreviewVersion(download.version) ||
      compareSemverVersions(download.version, input.currentVersion) <= 0
    ) {
      throw new CodeupMacInstallError(
        "Install a newer Codeup Preview release; other channels and downgrades are not supported.",
      );
    }
    step = "checking the installed application";
    await requirePreviewBundle(appPath);
    if ((await bundleValue(appPath, "CFBundleShortVersionString")) !== input.currentVersion) {
      throw new CodeupMacInstallError("The installed app changed. Restart it before updating.");
    }
    const parent = NodePath.dirname(appPath);
    const lockPath = NodePath.join(parent, ".t3-codeup-install-lock");
    step = "locking the writable application folder (another installation may be running)";
    await NodeFSP.mkdir(lockPath, { mode: 0o700 });
    lock = lockPath;
    work = await NodeFSP.mkdtemp(NodePath.join(parent, ".t3-codeup-install-"));

    step = "verifying the downloaded archive checksum";
    const archiveName = NodePath.basename(download.downloadedFile);
    const entry = download.files.find(
      (file) =>
        NodePath.basename(new URL(file.url, "https://invalid.local/").pathname) === archiveName,
    );
    if (!entry || !archiveName.endsWith(".zip")) throw new Error("Missing ZIP checksum");
    const hash = NodeCrypto.createHash("sha512");
    for await (const chunk of NodeFS.createReadStream(download.downloadedFile)) hash.update(chunk);
    if (hash.digest("base64") !== entry.sha512) throw new Error("Checksum mismatch");

    step = "extracting the update";
    const { stdout: listing } = await execute("/usr/bin/unzip", ["-Z1", download.downloadedFile], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const appName = `${CODEUP_PREVIEW.productName}.app`;
    const names = listing.trim().split("\n");
    if (names.some((name) => !name.startsWith(`${appName}/`) || name.split("/").includes(".."))) {
      throw new Error("Unexpected archive layout");
    }
    await execute("/usr/bin/ditto", ["-x", "-k", download.downloadedFile, work]);
    const staged = NodePath.join(work, appName);
    step = "verifying the new application identity and version";
    await requirePreviewBundle(staged);
    if ((await bundleValue(staged, "CFBundleShortVersionString")) !== download.version) {
      throw new Error("Bundle version mismatch");
    }
    step = "verifying the new application signature";
    await execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", staged]);
    step = "checking the new application architecture";
    const executable = await bundleValue(staged, "CFBundleExecutable");
    if (NodePath.basename(executable) !== executable) throw new Error("Invalid executable");
    const { stdout: archs } = await execute("/usr/bin/lipo", [
      "-archs",
      NodePath.join(staged, "Contents", "MacOS", executable),
    ]);
    const translated =
      input.architecture === "x64"
        ? await execute("/usr/sbin/sysctl", ["-in", "sysctl.proc_translated"]).then(
            (r) => r.stdout.trim() === "1",
            () => false,
          )
        : false;
    const arch = input.architecture === "arm64" || translated ? "arm64" : "x86_64";
    if (!archs.trim().split(/\s+/).includes(arch)) throw new Error("Architecture mismatch");

    const backup = NodePath.join(parent, ".t3-codeup-previous.app");
    step = "preparing the previous application backup";
    if (
      await NodeFSP.lstat(backup).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      )
    ) {
      await requirePreviewBundle(backup);
      await NodeFSP.rm(backup, { recursive: true });
    }
    const script = NodePath.join(work, "install.sh");
    await NodeFSP.writeFile(script, CODEUP_MAC_INSTALL_SCRIPT, { mode: 0o700 });
    return { appPath, staged, backup, work, lock, script };
  } catch (cause) {
    if (work) await NodeFSP.rm(work, { recursive: true, force: true }).catch(() => {});
    if (lock) await NodeFSP.rmdir(lock).catch(() => {});
    if (cause instanceof CodeupMacInstallError) throw cause;
    throw new CodeupMacInstallError(
      `Could not finish ${step}. The installed app is unchanged. Try the release DMG.`,
      { cause },
    );
  }
}

/** The helper inherits only the exact PID to wait for, and never kills an application. */
export async function launchCodeupMacInstall(
  prepared: Awaited<ReturnType<typeof prepareCodeupMacInstall>>,
  parentPid: number,
  logPath: string,
): Promise<NodeChildProcess.ChildProcess> {
  let log: NodeFSP.FileHandle | undefined;
  try {
    log = await NodeFSP.open(logPath, "a", 0o600);
    const logFd = log.fd;
    return await new Promise<NodeChildProcess.ChildProcess>((resolve, reject) => {
      const child = NodeChildProcess.spawn(
        "/bin/sh",
        [
          prepared.script,
          String(parentPid),
          prepared.appPath,
          prepared.staged,
          prepared.backup,
          prepared.work,
          prepared.lock,
        ],
        {
          detached: true,
          stdio: ["ignore", logFd, logFd],
          cwd: NodePath.dirname(prepared.appPath),
        },
      );
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve(child);
      });
    });
  } catch (cause) {
    await NodeFSP.rm(prepared.work, { recursive: true, force: true }).catch(() => {});
    await NodeFSP.rmdir(prepared.lock).catch(() => {});
    throw new CodeupMacInstallError(
      "Could not start the installer. The installed app is unchanged. Try the release DMG.",
      { cause },
    );
  } finally {
    await log?.close();
  }
}
