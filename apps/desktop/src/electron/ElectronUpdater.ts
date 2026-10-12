import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Electron from "electron";
import { isCodeupPreviewVersion } from "@t3tools/shared/codeupPreview";

import { autoUpdater } from "electron-updater";
import {
  CodeupMacInstallError,
  launchCodeupMacInstall,
  prepareCodeupMacInstall,
} from "./CodeupMacInstaller.ts";

let downloadedUpdate: unknown;

type AutoUpdater = typeof autoUpdater;

export type ElectronUpdaterFeedUrl = Parameters<AutoUpdater["setFeedURL"]>[0];

export class ElectronUpdaterCheckForUpdatesError extends Schema.TaggedError<ElectronUpdaterCheckForUpdatesError>()(
  "ElectronUpdaterCheckForUpdatesError",
  {
    channel: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to check for updates on channel ${this.channel ?? "default"}.`;
  }
}

export class ElectronUpdaterDownloadUpdateError extends Schema.TaggedError<ElectronUpdaterDownloadUpdateError>()(
  "ElectronUpdaterDownloadUpdateError",
  {
    channel: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Electron updater failed to download the update on channel ${this.channel ?? "default"}.`;
  }
}

export class ElectronUpdaterQuitAndInstallError extends Schema.TaggedError<ElectronUpdaterQuitAndInstallError>()(
  "ElectronUpdaterQuitAndInstallError",
  {
    channel: Schema.NullOr(Schema.String),
    isSilent: Schema.Boolean,
    isForceRunAfter: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    if (this.cause instanceof CodeupMacInstallError) return this.cause.message;
    return `Electron updater failed to quit and install the update on channel ${this.channel ?? "default"} (silent: ${this.isSilent}, force run after: ${this.isForceRunAfter}).`;
  }
}

export const ElectronUpdaterError = Schema.Union([
  ElectronUpdaterCheckForUpdatesError,
  ElectronUpdaterDownloadUpdateError,
  ElectronUpdaterQuitAndInstallError,
]);
export type ElectronUpdaterError = typeof ElectronUpdaterError.Type;

export class ElectronUpdater extends Context.Service<
  ElectronUpdater,
  {
    readonly setFeedURL: (options: ElectronUpdaterFeedUrl) => Effect.Effect<void>;
    readonly setAutoDownload: (value: boolean) => Effect.Effect<void>;
    readonly setAutoInstallOnAppQuit: (value: boolean) => Effect.Effect<void>;
    readonly setChannel: (channel: string) => Effect.Effect<void>;
    readonly setAllowPrerelease: (value: boolean) => Effect.Effect<void>;
    readonly allowDowngrade: Effect.Effect<boolean>;
    readonly setAllowDowngrade: (value: boolean) => Effect.Effect<void>;
    readonly setFullChangelog: (value: boolean) => Effect.Effect<void>;
    readonly setDisableDifferentialDownload: (value: boolean) => Effect.Effect<void>;
    readonly checkForUpdates: Effect.Effect<void, ElectronUpdaterCheckForUpdatesError>;
    readonly downloadUpdate: Effect.Effect<void, ElectronUpdaterDownloadUpdateError>;
    readonly quitAndInstall: (options: {
      readonly isSilent: boolean;
      readonly isForceRunAfter: boolean;
    }) => Effect.Effect<void, ElectronUpdaterQuitAndInstallError>;
    readonly on: <Args extends ReadonlyArray<unknown>>(
      eventName: string,
      listener: (...args: Args) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronUpdater") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = ElectronUpdater.of({
  setFeedURL: (options) =>
    Effect.suspend(() => {
      autoUpdater.setFeedURL(options);
      return Effect.void;
    }),
  setAutoDownload: (value) =>
    Effect.suspend(() => {
      autoUpdater.autoDownload = value;
      return Effect.void;
    }),
  setAutoInstallOnAppQuit: (value) =>
    Effect.suspend(() => {
      autoUpdater.autoInstallOnAppQuit = value;
      return Effect.void;
    }),
  setChannel: (channel) =>
    Effect.suspend(() => {
      autoUpdater.channel = channel;
      return Effect.void;
    }),
  setAllowPrerelease: (value) =>
    Effect.suspend(() => {
      autoUpdater.allowPrerelease = value;
      return Effect.void;
    }),
  allowDowngrade: Effect.sync(() => autoUpdater.allowDowngrade),
  setAllowDowngrade: (value) =>
    Effect.suspend(() => {
      autoUpdater.allowDowngrade = value;
      return Effect.void;
    }),
  setFullChangelog: (value) =>
    Effect.suspend(() => {
      autoUpdater.fullChangelog = value;
      return Effect.void;
    }),
  setDisableDifferentialDownload: (value) =>
    Effect.suspend(() => {
      autoUpdater.disableDifferentialDownload = value;
      return Effect.void;
    }),
  checkForUpdates: Effect.suspend(() => {
    const channel = autoUpdater.channel;
    return Effect.tryPromise({
      try: () => autoUpdater.checkForUpdates(),
      catch: (cause) => new ElectronUpdaterCheckForUpdatesError({ channel, cause }),
    }).pipe(Effect.asVoid);
  }),
  downloadUpdate: Effect.suspend(() => {
    const channel = autoUpdater.channel;
    return Effect.tryPromise({
      try: () => autoUpdater.downloadUpdate(),
      catch: (cause) => new ElectronUpdaterDownloadUpdateError({ channel, cause }),
    }).pipe(Effect.asVoid);
  }),
  quitAndInstall: ({ isSilent, isForceRunAfter }) =>
    Effect.gen(function* () {
      const platform = yield* HostProcess.Platform;
      const architecture = yield* HostProcess.Architecture;
      const channel = autoUpdater.channel;
      return yield* Effect.tryPromise({
        try: async () => {
          if (
            platform === "darwin" &&
            Electron.app.isPackaged &&
            isCodeupPreviewVersion(Electron.app.getVersion())
          ) {
            const prepared = await prepareCodeupMacInstall({
              executable: Electron.app.getPath("exe"),
              currentVersion: Electron.app.getVersion(),
              architecture,
              download: downloadedUpdate,
            });
            await launchCodeupMacInstall(
              prepared,
              process.pid,
              `${Electron.app.getPath("userData")}/codeup-update.log`,
            );
            Electron.app.quit();
            return;
          }
          autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
        },
        catch: (cause) =>
          new ElectronUpdaterQuitAndInstallError({
            channel,
            isSilent,
            isForceRunAfter,
            cause,
          }),
      });
    }),
  on: (eventName, listener) => {
    const eventTarget = autoUpdater as unknown as {
      on: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
      removeListener: (eventName: string, listener: (...args: Array<unknown>) => void) => void;
    };
    const originalListener = listener as unknown as (...args: Array<unknown>) => void;
    const untypedListener =
      eventName === "update-downloaded"
        ? (...args: Array<unknown>) => {
            downloadedUpdate = args[0];
            originalListener(...args);
          }
        : originalListener;
    return Effect.acquireRelease(
      Effect.sync(() => {
        eventTarget.on(eventName, untypedListener);
      }),
      () =>
        Effect.sync(() => {
          eventTarget.removeListener(eventName, untypedListener);
        }),
    ).pipe(Effect.asVoid);
  },
});

export const layer = Layer.succeed(ElectronUpdater, make);
