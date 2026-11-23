/**
 * Standalone issue trackers as Settings manages them: one credential per tracker account in the
 * secret store, and the per-project binding that puts an account's scope beside the project's
 * git-host issues. A tracker's first account predates accounts and has no id; each added one
 * gets its own. Disconnecting an account clears the bindings that pointed at it.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as DateTime from "effect/DateTime";
import * as SecureRandom from "effect/crypto/SecureRandom";
import {
  IssueTrackerAccountId,
  IssueTrackerConnectionError,
  IssueTrackerKind,
  type IssueTrackerBindProjectInput,
  type IssueTrackerConnectInput,
  type IssueTrackerConnection,
  type IssueTrackerConnectionList,
} from "@t3tools/contracts";
import {
  IssueTrackerError,
  type IssueTrackerLogin,
  type StandaloneIssueTrackerApi,
} from "@t3tools/source-control-core/server/IssueTracker";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as IssueTrackerBindings from "../persistence/IssueTrackerBindings.ts";
import * as IssueService from "./IssueService.ts";
import {
  decodeIssueTrackerCredential,
  encodeIssueTrackerCredential,
  issueTrackerSecretName,
} from "./IssueTrackerHostLive.ts";
import * as IssueTrackerRegistry from "./IssueTrackerRegistry.ts";

export class IssueTrackerConnections extends Context.Service<
  IssueTrackerConnections,
  {
    /** Every standalone tracker account, each probed against its stored credential, and the bindings. */
    readonly list: Effect.Effect<IssueTrackerConnectionList, IssueTrackerConnectionError>;
    /**
     * Vets the credential with the tracker and stores it only when the tracker accepts it. A null
     * token removes the stored one and unbinds every project that pointed at the account.
     */
    readonly connect: (
      input: IssueTrackerConnectInput,
    ) => Effect.Effect<IssueTrackerConnection, IssueTrackerConnectionError>;
    /** Binds a project to one of an account's scopes, or unbinds it with a null binding. */
    readonly bindProject: (
      input: IssueTrackerBindProjectInput,
    ) => Effect.Effect<void, IssueTrackerConnectionError>;
  }
>()("t3/issue/IssueTrackerConnections") {}

const make = Effect.gen(function* () {
  const registry = yield* IssueTrackerRegistry.IssueTrackerRegistry;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const bindings = yield* IssueTrackerBindings.IssueTrackerBindingsRepository;
  // Account checks, credential writes, and removals run one at a time, so a removal cannot land
  // between a check and the write that relied on it.
  const accountLock = yield* Semaphore.make(1);
  const random = yield* SecureRandom.SecureRandom;

  const requireTracker = (
    tracker: IssueTrackerKind,
  ): Effect.Effect<StandaloneIssueTrackerApi, IssueTrackerConnectionError> => {
    const found = registry.standalone.find((api) => api.kind === tracker);
    return found === undefined
      ? Effect.fail(
          new IssueTrackerConnectionError({
            tracker,
            reason: "unknown-tracker",
            detail: "This server has no such issue tracker.",
          }),
        )
      : Effect.succeed(found);
  };

  /** The kind an error about no tracker in particular is filed under. */
  const anyTracker = registry.standalone[0]?.kind ?? IssueTrackerKind.make("none");

  const secretFailure = (tracker: IssueTrackerKind, detail: string) => (cause: unknown) =>
    new IssueTrackerConnectionError({ tracker, reason: "failed", detail, cause });

  const accountFields = (accountId: IssueTrackerAccountId | null) =>
    accountId === null ? {} : { accountId };

  const disconnected = (
    api: StandaloneIssueTrackerApi,
    accountId: IssueTrackerAccountId | null,
  ): IssueTrackerConnection => ({
    ...api.standalone,
    ...accountFields(accountId),
    connected: false,
    account: null,
    detail: null,
    scopes: [],
  });

  const requireAccount = Effect.fn("IssueTrackerConnections.requireAccount")(function* (
    tracker: IssueTrackerKind,
    accountId: IssueTrackerAccountId | undefined,
  ) {
    if (accountId === undefined) return null;
    const saved = yield* bindings.listAccounts.pipe(
      Effect.mapError(secretFailure(tracker, "The saved accounts could not be read.")),
    );
    if (saved.some((account) => account.tracker === tracker && account.accountId === accountId))
      return accountId;
    return yield* new IssueTrackerConnectionError({
      tracker,
      reason: "failed",
      detail: "This account is not saved on the server.",
    });
  });

  const probeLogin = (api: StandaloneIssueTrackerApi, token: string | null) =>
    token !== null
      ? api.probeCredential(token)
      : (api.probeEnvironmentLogin ??
        Effect.fail(
          new IssueTrackerError({
            tracker: api.kind,
            operation: "probeEnvironmentLogin",
            reason: "failed",
            detail: "This tracker does not support using the environment login.",
          }),
        ));

  const connected = (
    api: StandaloneIssueTrackerApi,
    accountId: IssueTrackerAccountId | null,
    login: IssueTrackerLogin,
    token: string | null,
  ): IssueTrackerConnection => ({
    ...api.standalone,
    ...accountFields(accountId),
    connected: true,
    ...(token === null ? { usesEnvironmentLogin: true as const } : {}),
    account: login.account,
    detail: null,
    ...(login.workspace === undefined ? {} : { workspace: login.workspace }),
    scopes: login.scopes,
  });

  /** A refusal is status so the user can replace or disconnect the credential. */
  const status = (
    api: StandaloneIssueTrackerApi,
    accountId: IssueTrackerAccountId | null,
    token: string | null,
  ) =>
    probeLogin(api, token).pipe(
      Effect.map((login) => connected(api, accountId, login, token)),
      Effect.catch((error) =>
        Effect.succeed<IssueTrackerConnection>({
          ...api.standalone,
          ...accountFields(accountId),
          connected: true,
          ...(token === null ? { usesEnvironmentLogin: true as const } : {}),
          account: null,
          detail: IssueService.trackerDetail(error),
          scopes: [],
        }),
      ),
    );

  const current = (api: StandaloneIssueTrackerApi, accountId: IssueTrackerAccountId | null) =>
    secrets.get(issueTrackerSecretName(api.kind, accountId)).pipe(
      Effect.mapError(secretFailure(api.kind, "The stored credential could not be read.")),
      Effect.flatMap((stored) =>
        Option.isNone(stored)
          ? Effect.succeed(disconnected(api, accountId))
          : status(api, accountId, decodeIssueTrackerCredential(stored.value)),
      ),
    );

  const list: IssueTrackerConnections["Service"]["list"] = Effect.all({
    trackers: Effect.forEach(registry.standalone, (api) => current(api, null), { concurrency: 4 }),
    accounts: bindings.listAccounts.pipe(
      Effect.mapError(secretFailure(anyTracker, "The saved accounts could not be read.")),
      Effect.flatMap((accounts) =>
        Effect.forEach(
          accounts.flatMap((account) => {
            const api = registry.standalone.find((tracker) => tracker.kind === account.tracker);
            return api === undefined ? [] : [{ api, accountId: account.accountId }];
          }),
          ({ api, accountId }) => current(api, accountId),
          { concurrency: 4 },
        ),
      ),
    ),
    bindings: bindings.list().pipe(
      // No single tracker is at fault; the first registered one carries the report.
      Effect.mapError(secretFailure(anyTracker, "The project bindings could not be read.")),
    ),
  }).pipe(
    Effect.map(({ trackers, accounts, bindings: bound }) => {
      const all = [...bound];
      return {
        trackers,
        accounts,
        bindings: Object.fromEntries(all.filter(([, binding]) => binding.accountId === undefined)),
        accountBindings: Object.fromEntries(
          all.filter(([, binding]) => binding.accountId !== undefined),
        ),
      };
    }),
  );

  const disconnect = Effect.fn("IssueTrackerConnections.disconnect")(function* (
    api: StandaloneIssueTrackerApi,
    accountId: IssueTrackerAccountId | null,
  ) {
    yield* secrets
      .remove(issueTrackerSecretName(api.kind, accountId))
      .pipe(Effect.mapError(secretFailure(api.kind, "The credential could not be removed.")));
    // Bindings to an account nobody is signed into would only produce errors in every listing.
    yield* bindings
      .removeAccount({ tracker: api.kind, accountId })
      .pipe(Effect.mapError(secretFailure(api.kind, "The project bindings could not be cleared.")));
    return disconnected(api, accountId);
  });

  /** Whether another of the tracker's accounts already holds this exact credential. */
  const heldElsewhere = Effect.fn("IssueTrackerConnections.heldElsewhere")(function* (
    api: StandaloneIssueTrackerApi,
    accountId: IssueTrackerAccountId | null,
    token: string | null,
  ) {
    const saved = yield* bindings.listAccounts.pipe(
      Effect.mapError(secretFailure(api.kind, "The saved accounts could not be read.")),
    );
    const others = [
      null,
      ...saved
        .filter((account) => account.tracker === api.kind)
        .map((account) => account.accountId),
    ].filter((other) => other !== accountId);
    for (const other of others) {
      const stored = yield* secrets
        .get(issueTrackerSecretName(api.kind, other))
        .pipe(Effect.mapError(secretFailure(api.kind, "The stored credential could not be read.")));
      if (Option.isSome(stored) && decodeIssueTrackerCredential(stored.value) === token)
        return true;
    }
    return false;
  });

  const connect: IssueTrackerConnections["Service"]["connect"] = Effect.fn(
    "IssueTrackerConnections.connect",
  )(function* (input) {
    const api = yield* requireTracker(input.tracker);
    const tokenInput = "token" in input ? input : null;
    const addAccount = tokenInput?.addAccount === true;
    const token = tokenInput?.token ?? null;
    if (tokenInput?.token === null) {
      if (addAccount) {
        return yield* new IssueTrackerConnectionError({
          tracker: input.tracker,
          reason: "failed",
          detail: "A new account needs a credential.",
        });
      }
      return yield* accountLock.withPermits(1)(
        Effect.flatMap(requireAccount(api.kind, input.accountId), (existing) =>
          disconnect(api, existing),
        ),
      );
    }
    // The tracker is asked before the lock, so a slow probe never holds up other settings.
    const probed = yield* probeLogin(api, token).pipe(
      Effect.mapError(
        (error) =>
          new IssueTrackerConnectionError({
            tracker: input.tracker,
            reason: error.reason === "unauthenticated" ? "rejected" : "failed",
            detail: IssueService.trackerDetail(error),
            cause: error,
          }),
      ),
    );
    const accountId = yield* accountLock.withPermits(1)(
      Effect.gen(function* () {
        const accountId = addAccount
          ? IssueTrackerAccountId.make(
              yield* random
                .uuidV4()
                .pipe(
                  Effect.mapError(secretFailure(api.kind, "The account could not be created.")),
                ),
            )
          : yield* requireAccount(api.kind, input.accountId);
        if (yield* heldElsewhere(api, accountId, token)) {
          return yield* new IssueTrackerConnectionError({
            tracker: input.tracker,
            reason: "failed",
            detail: "This credential is already connected as another account.",
          });
        }
        yield* secrets
          .set(issueTrackerSecretName(api.kind, accountId), encodeIssueTrackerCredential(token))
          .pipe(Effect.mapError(secretFailure(api.kind, "The credential could not be stored.")));
        if (addAccount && accountId !== null) {
          const createdAt = DateTime.formatIso(yield* DateTime.now);
          yield* bindings.addAccount({ tracker: api.kind, accountId, createdAt }).pipe(
            Effect.tapError(() =>
              Effect.ignore(secrets.remove(issueTrackerSecretName(api.kind, accountId))),
            ),
            Effect.mapError(secretFailure(api.kind, "The account could not be saved.")),
          );
        }
        return accountId;
      }),
    );
    return connected(api, accountId, probed, token);
  });

  const bindProject: IssueTrackerConnections["Service"]["bindProject"] = Effect.fn(
    "IssueTrackerConnections.bindProject",
  )(function* (input) {
    if (input.binding === null) {
      // Older clients cannot see a project bound with an added account and offer it as unbound;
      // an unbind that does not name the binding's account leaves it alone.
      const current = (yield* bindings
        .list(input.projectId)
        .pipe(
          Effect.mapError(secretFailure(anyTracker, "The project bindings could not be read.")),
        )).get(input.projectId);
      if (current !== undefined && current.accountId !== input.accountId) return;
    } else {
      yield* requireAccount(
        (yield* requireTracker(input.binding.tracker)).kind,
        input.binding.accountId,
      );
    }
    // Unbinding names no tracker; the first registered one carries any report.
    const tracker = input.binding?.tracker ?? anyTracker;
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    yield* bindings
      .set({ projectId: input.projectId, binding: input.binding, updatedAt })
      .pipe(Effect.mapError(secretFailure(tracker, "The project binding could not be saved.")));
  }, accountLock.withPermits(1));

  return IssueTrackerConnections.of({ list, connect, bindProject });
});

export const layer = Layer.effect(IssueTrackerConnections, make);
