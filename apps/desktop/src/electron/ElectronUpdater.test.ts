import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vite-plus/test";

const { autoUpdaterMock, appMock, installerMock } = vi.hoisted(() => ({
  appMock: {
    isPackaged: true,
    getVersion: vi.fn(() => "0.0.46-nightly.20261012.3021"),
    getPath: vi.fn((key: string) => `/tmp/installer-test/${key}`),
    quit: vi.fn(),
  },
  installerMock: { prepareCodeupMacInstall: vi.fn(), launchCodeupMacInstall: vi.fn() },
  autoUpdaterMock: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    channel: "latest",
    disableDifferentialDownload: false,
    fullChangelog: false,
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve([])),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    removeListener: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

vi.mock("electron-updater", () => ({
  autoUpdater: autoUpdaterMock,
}));

vi.mock("electron", () => ({ app: appMock }));
vi.mock("./CodeupMacInstaller.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./CodeupMacInstaller.ts")>()),
  ...installerMock,
}));

import * as ElectronUpdater from "./ElectronUpdater.ts";
import { CodeupMacInstallError } from "./CodeupMacInstaller.ts";

describe("ElectronUpdater", () => {
  beforeEach(() => {
    appMock.getVersion.mockReturnValue("0.0.46-nightly.20261012.3021");
    appMock.quit.mockClear();
    installerMock.prepareCodeupMacInstall.mockReset();
    installerMock.launchCodeupMacInstall.mockReset();
    autoUpdaterMock.allowDowngrade = false;
    autoUpdaterMock.allowPrerelease = false;
    autoUpdaterMock.autoDownload = true;
    autoUpdaterMock.autoInstallOnAppQuit = true;
    autoUpdaterMock.channel = "latest";
    autoUpdaterMock.disableDifferentialDownload = false;
    autoUpdaterMock.fullChangelog = false;
    autoUpdaterMock.checkForUpdates.mockClear();
    autoUpdaterMock.checkForUpdates.mockImplementation(() => Promise.resolve(null));
    autoUpdaterMock.downloadUpdate.mockClear();
    autoUpdaterMock.downloadUpdate.mockImplementation(() => Promise.resolve([]));
    autoUpdaterMock.on.mockClear();
    autoUpdaterMock.quitAndInstall.mockClear();
    autoUpdaterMock.removeListener.mockClear();
    autoUpdaterMock.setFeedURL.mockClear();
  });

  it.effect("scopes updater event listeners", () =>
    Effect.gen(function* () {
      const listener = vi.fn();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const updater = yield* ElectronUpdater.ElectronUpdater;
          yield* updater.on("update-available", listener);
        }),
      );

      assert.deepEqual(autoUpdaterMock.on.mock.calls, [["update-available", listener]]);
      assert.deepEqual(autoUpdaterMock.removeListener.mock.calls, [["update-available", listener]]);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("wraps rejected update checks in the method-specific typed error", () =>
    Effect.gen(function* () {
      const cause = new Error("network unavailable");
      autoUpdaterMock.checkForUpdates.mockImplementationOnce(() => Promise.reject(cause));
      const updater = yield* ElectronUpdater.ElectronUpdater;
      autoUpdaterMock.channel = "beta";

      const error = yield* updater.checkForUpdates.pipe(Effect.flip);

      assert.instanceOf(error, ElectronUpdater.ElectronUpdaterCheckForUpdatesError);
      assert.equal(error.channel, "beta");
      assert.strictEqual(error.cause, cause);
      assert.equal(error.message, "Electron updater failed to check for updates on channel beta.");
      assert.notInclude(error.message, cause.message);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("preserves the execution-time channel on download failures", () =>
    Effect.gen(function* () {
      const cause = new Error("download unavailable");
      autoUpdaterMock.downloadUpdate.mockImplementationOnce(() => Promise.reject(cause));
      const updater = yield* ElectronUpdater.ElectronUpdater;
      autoUpdaterMock.channel = "nightly";

      const error = yield* updater.downloadUpdate.pipe(Effect.flip);

      assert.instanceOf(error, ElectronUpdater.ElectronUpdaterDownloadUpdateError);
      assert.equal(error.channel, "nightly");
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        "Electron updater failed to download the update on channel nightly.",
      );
      assert.notInclude(error.message, cause.message);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("sets full changelog mode", () =>
    Effect.gen(function* () {
      const updater = yield* ElectronUpdater.ElectronUpdater;

      yield* updater.setFullChangelog(true);
      assert.equal(autoUpdaterMock.fullChangelog, true);

      yield* updater.setFullChangelog(false);
      assert.equal(autoUpdaterMock.fullChangelog, false);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );

  it.effect("preserves quit-and-install flags and the execution-time channel", () =>
    Effect.gen(function* () {
      const cause = new Error("quit and install failed");
      autoUpdaterMock.quitAndInstall.mockImplementationOnce(() => {
        throw cause;
      });
      const updater = yield* ElectronUpdater.ElectronUpdater;
      autoUpdaterMock.channel = "alpha";

      const error = yield* updater
        .quitAndInstall({ isSilent: true, isForceRunAfter: false })
        .pipe(Effect.flip);

      assert.instanceOf(error, ElectronUpdater.ElectronUpdaterQuitAndInstallError);
      assert.equal(error.channel, "alpha");
      assert.equal(error.isSilent, true);
      assert.equal(error.isForceRunAfter, false);
      assert.strictEqual(error.cause, cause);
      assert.equal(
        error.message,
        "Electron updater failed to quit and install the update on channel alpha (silent: true, force run after: false).",
      );
      assert.notInclude(error.message, cause.message);
      assert.deepEqual(autoUpdaterMock.quitAndInstall.mock.calls, [[true, false]]);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
  );
  it.effect(
    "installs a downloaded Codeup Mac release through the helper after explicit install",
    () =>
      Effect.gen(function* () {
        appMock.getVersion.mockReturnValue("0.0.46-codeup.20261012.16");
        const prepared = { appPath: "/tmp/installer-test/Preview.app" };
        installerMock.prepareCodeupMacInstall.mockResolvedValue(prepared);
        installerMock.launchCodeupMacInstall.mockResolvedValue(undefined);
        const updater = yield* ElectronUpdater.ElectronUpdater;
        const download = {
          version: "0.0.46-codeup.20261013.20",
          downloadedFile: "/tmp/update.zip",
        };
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* updater.on("update-downloaded", () => {});
            const listener = autoUpdaterMock.on.mock.calls.at(-1)?.[1];
            listener(download);
            assert.equal(appMock.quit.mock.calls.length, 0);
            yield* updater.quitAndInstall({ isSilent: true, isForceRunAfter: true });
          }),
        );
        assert.deepEqual(installerMock.prepareCodeupMacInstall.mock.calls[0]?.[0], {
          executable: "/tmp/installer-test/exe",
          currentVersion: "0.0.46-codeup.20261012.16",
          architecture: "arm64",
          download,
        });
        assert.equal(installerMock.launchCodeupMacInstall.mock.calls.length, 1);
        assert.equal(appMock.quit.mock.calls.length, 1);
        assert.equal(autoUpdaterMock.quitAndInstall.mock.calls.length, 0);
      }).pipe(
        Effect.provide(ElectronUpdater.layer),
        Effect.provideService(HostProcess.Platform, "darwin"),
        Effect.provideService(HostProcess.Architecture, "arm64"),
      ),
  );

  it.effect("keeps the app open and returns a safe actionable Codeup preparation failure", () =>
    Effect.gen(function* () {
      appMock.getVersion.mockReturnValue("0.0.46-codeup.20261012.16");
      installerMock.prepareCodeupMacInstall.mockRejectedValue(
        new CodeupMacInstallError(
          "Move Codeup Preview to a writable Applications folder before updating.",
          { cause: new Error("private internal detail") },
        ),
      );
      const updater = yield* ElectronUpdater.ElectronUpdater;
      const error = yield* updater
        .quitAndInstall({ isSilent: true, isForceRunAfter: true })
        .pipe(Effect.flip);
      assert.include(error.message, "writable Applications folder");
      assert.notInclude(error.message, "private internal detail");
      assert.equal(appMock.quit.mock.calls.length, 0);
      assert.equal(installerMock.launchCodeupMacInstall.mock.calls.length, 0);
    }).pipe(
      Effect.provide(ElectronUpdater.layer),
      Effect.provideService(HostProcess.Platform, "darwin"),
    ),
  );
});
