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
