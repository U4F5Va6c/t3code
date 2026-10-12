// @effect-diagnostics nodeBuiltinImport:off -- These native integration fixtures compile, sign and replace inert apps in temporary folders.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { CODEUP_PREVIEW } from "@t3tools/shared/codeupPreview";
import { afterEach, expect } from "vite-plus/test";
import { describe, it } from "@effect/vitest";
import { launchCodeupMacInstall, prepareCodeupMacInstall } from "./CodeupMacInstaller.ts";

const execute = NodeUtil.promisify(NodeChildProcess.execFile);
const roots: string[] = [];
const oldVersion = "0.0.46-codeup.20261012.16";
const newVersion = "0.0.46-codeup.20261013.20";

afterEach(async () => {
  for (const root of roots.splice(0)) {
    // Test bundles have the real Fork ID but contain only a tiny, inert test executable.
    await execute(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-u", NodePath.join(root, "installed", `${CODEUP_PREVIEW.productName}.app`)],
    ).catch(() => {});
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

async function fixture(architecture: string) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codeup-installer-test-"));
  roots.push(root);
  const source = NodePath.join(root, "main.c");
  await NodeFSP.writeFile(source, "int main(void) { return 0; }\n");
  for (const [directory, version] of [
    ["installed", oldVersion],
    ["release", newVersion],
  ]) {
    const app = NodePath.join(root, directory!, `${CODEUP_PREVIEW.productName}.app`);
    const macos = NodePath.join(app, "Contents", "MacOS");
    await NodeFSP.mkdir(macos, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(app, "Contents", "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${CODEUP_PREVIEW.appId}</string><key>CFBundleExecutable</key><string>InstallerTest</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>1</string></dict></plist>`,
    );
    await execute("/usr/bin/clang", [source, "-o", NodePath.join(macos, "InstallerTest")]);
    await execute("/usr/bin/codesign", ["--force", "--sign", "-", app]);
  }
  const appPath = NodePath.join(root, "installed", `${CODEUP_PREVIEW.productName}.app`);
  const archive = NodePath.join(root, "update-arm64.zip");
  await execute("/usr/bin/ditto", [
    "-c",
    "-k",
    "--keepParent",
    NodePath.join(root, "release", `${CODEUP_PREVIEW.productName}.app`),
    archive,
  ]);
  const sha512 = NodeCrypto.createHash("sha512")
    .update(await NodeFSP.readFile(archive))
    .digest("base64");
  return {
    root,
    appPath,
    input: {
      executable: NodePath.join(appPath, "Contents", "MacOS", "InstallerTest"),
      currentVersion: oldVersion,
      architecture,
      download: {
        version: newVersion,
        downloadedFile: archive,
        files: [{ url: "update-arm64.zip", sha512 }],
      },
    },
  };
}

describe("Codeup Mac installer", () => {
  it.effect("refuses a corrupted download before touching the installed app", () =>
    Effect.gen(function* () {
      if ((yield* HostProcess.Platform) !== "darwin") return;
      const architecture = yield* HostProcess.Architecture;
      yield* Effect.promise(async () => {
        const f = await fixture(architecture);
        await NodeFSP.appendFile(f.input.download.downloadedFile, "corruption");
        await expect(prepareCodeupMacInstall(f.input)).rejects.toThrow("archive checksum");
        await expect(NodeFSP.access(f.input.executable)).resolves.toBeUndefined();
        expect(await NodeFSP.readdir(NodePath.dirname(f.appPath))).toEqual([
          NodePath.basename(f.appPath),
        ]);
      });
    }),
  );

  it.effect("refuses another channel, a downgrade and an unrelated installed bundle", () =>
    Effect.gen(function* () {
      if ((yield* HostProcess.Platform) !== "darwin") return;
      const architecture = yield* HostProcess.Architecture;
      yield* Effect.promise(async () => {
        const f = await fixture(architecture);
        await expect(
          prepareCodeupMacInstall({
            ...f.input,
            download: { ...f.input.download, version: "0.0.47" },
          }),
        ).rejects.toThrow("newer Codeup");
        await expect(
          prepareCodeupMacInstall({
            ...f.input,
            download: { ...f.input.download, version: oldVersion },
          }),
        ).rejects.toThrow("newer Codeup");
        await execute("/usr/libexec/PlistBuddy", [
          "-c",
          "Set CFBundleIdentifier com.example.official",
          NodePath.join(f.appPath, "Contents", "Info.plist"),
        ]);
        await expect(prepareCodeupMacInstall(f.input)).rejects.toThrow("not Codeup Preview");
      });
    }),
  );

  it.effect("verifies the staged bundle version, not only the archive metadata", () =>
    Effect.gen(function* () {
      if ((yield* HostProcess.Platform) !== "darwin") return;
      const architecture = yield* HostProcess.Architecture;
      yield* Effect.promise(async () => {
        const f = await fixture(architecture);
        await expect(
          prepareCodeupMacInstall({
            ...f.input,
            download: { ...f.input.download, version: "0.0.46-codeup.20261013.21" },
          }),
        ).rejects.toThrow("identity and version");
      });
    }),
  );

  it.effect(
    "recovers an abandoned lock, excludes concurrent installs and retains the previous app",
    () =>
      Effect.gen(function* () {
        if ((yield* HostProcess.Platform) !== "darwin") return;
        const architecture = yield* HostProcess.Architecture;
        yield* Effect.promise(async () => {
          const f = await fixture(architecture);
          const prepared = await prepareCodeupMacInstall(f.input);
          const concurrent = await prepareCodeupMacInstall(f.input);
          // An interrupted installer can leave the inode, but cannot keep the kernel lock.
          await NodeFSP.writeFile(prepared.lock, "");
          const parent = NodeChildProcess.spawn("/bin/cat", [], {
            stdio: ["pipe", "ignore", "ignore"],
          });
          expect(parent.pid).toBeDefined();
          try {
            const helper = await launchCodeupMacInstall(
              prepared,
              parent.pid!,
              NodePath.join(f.root, "install.log"),
            );
            const exited = new Promise<number | null>((resolve, reject) => {
              helper.once("error", reject);
              helper.once("exit", resolve);
            });
            await expect(
              launchCodeupMacInstall(concurrent, parent.pid!, NodePath.join(f.root, "second.log")),
            ).rejects.toThrow("Could not start the installer");
            await expect(NodeFSP.access(concurrent.work)).rejects.toMatchObject({ code: "ENOENT" });
            expect(
              await NodeFSP.readFile(NodePath.join(f.appPath, "Contents", "Info.plist"), "utf8"),
            ).toContain(oldVersion);
            parent.stdin!.end();
            const code = await exited;
            expect(code).toBe(0);
            expect(
              await NodeFSP.readFile(NodePath.join(f.appPath, "Contents", "Info.plist"), "utf8"),
            ).toContain(newVersion);
            expect(
              await NodeFSP.readFile(
                NodePath.join(prepared.backup, "Contents", "Info.plist"),
                "utf8",
              ),
            ).toContain(oldVersion);
            await execute("/usr/bin/lockf", ["-k", "-t", "0", prepared.lock, "/usr/bin/true"]);
            await expect(NodeFSP.access(prepared.work)).rejects.toMatchObject({ code: "ENOENT" });
          } finally {
            parent.stdin?.end();
          }
        });
      }),
    { timeout: 20_000 },
  );

  it.effect(
    "restores the previous app when replacing the staged app fails",
    () =>
      Effect.gen(function* () {
        if ((yield* HostProcess.Platform) !== "darwin") return;
        const architecture = yield* HostProcess.Architecture;
        yield* Effect.promise(async () => {
          const f = await fixture(architecture);
          const prepared = await prepareCodeupMacInstall(f.input);
          await NodeFSP.rm(prepared.staged, { recursive: true });
          // Suppress only the failure alert in this test; the real rename/restore/open commands run.
          const script = await NodeFSP.readFile(prepared.script, "utf8");
          await NodeFSP.writeFile(
            prepared.script,
            script.replace("/usr/bin/osascript", "/usr/bin/true"),
          );
          const parent = NodeChildProcess.spawn("/bin/cat", [], {
            stdio: ["pipe", "ignore", "ignore"],
          });
          expect(parent.pid).toBeDefined();
          try {
            const helper = await launchCodeupMacInstall(
              prepared,
              parent.pid!,
              NodePath.join(f.root, "install.log"),
            );
            const exited = new Promise<number | null>((resolve, reject) => {
              helper.once("error", reject);
              helper.once("exit", resolve);
            });
            parent.stdin!.end();
            const code = await exited;
            expect(code).toBe(1);
            expect(
              await NodeFSP.readFile(NodePath.join(f.appPath, "Contents", "Info.plist"), "utf8"),
            ).toContain(oldVersion);
            await execute("/usr/bin/lockf", ["-k", "-t", "0", prepared.lock, "/usr/bin/true"]);
            await expect(NodeFSP.access(prepared.work)).rejects.toMatchObject({ code: "ENOENT" });
          } finally {
            parent.stdin?.end();
          }
        });
      }),
    { timeout: 20_000 },
  );
});
