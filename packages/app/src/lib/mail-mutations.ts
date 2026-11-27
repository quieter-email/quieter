import {
  deferredMailPersistence,
  mailMutationCoordinators,
  pendingMailMutations,
} from "@quieter/app/lib/mail-mutation-state";
import {
  flushMailPersistence,
  persistQueryByKey,
} from "@quieter/app/lib/query-persister";
import { notifyManager } from "@tanstack/react-query";
import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

type IntentInput = {
  mailboxId: string;
  targets: string[];
  coalesceKey?: string;
  apply?: () => void;
  execute: () => Promise<(() => void) | undefined>;
};

type Intent = IntentInput & {
  started: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
  promise: Promise<void>;
};

type CatchUpListener = (
  mailboxId: string,
  threadIds: readonly string[]
) => void;

const getQueryMailboxId = (key: QueryKey) => {
  if (key.length === 4) {
    if (key[0] === "messages") {
      return key[1];
    }
    if (key[0] === "message-thread") {
      return key[2];
    }
  }
  return null;
};

const overlaps = (left: IntentInput, right: IntentInput) =>
  left.mailboxId === right.mailboxId &&
  left.targets.some((id) => right.targets.includes(id));

const createCoordinator = (client: QueryClient) => {
  const cache = client.getQueryCache();
  const base = new Map<
    string,
    { key: QueryKey; data: unknown; updatedAt: number }
  >();
  const guardedReads = new Map<string, Promise<unknown>>();
  const catchUps = new Map<
    string,
    { targets: Set<string>; interrupted: Set<string> }
  >();
  const versions = new Map<string, number>();
  const listeners = new Set<CatchUpListener>();
  let intents: Intent[] = [];
  let disposed = false;
  let rendering = false;
  let unsubscribe: (() => void) | undefined;

  const stopObservingIfIdle = () => {
    if (intents.length === 0 && guardedReads.size === 0) {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  };

  const guardRead = async (query: Query, mailboxId: string) => {
    const { promise, queryHash } = query;
    if (query.state.fetchStatus === "idle" || !promise) {
      return;
    }
    // The retryer can resolve before its already queued success continuation.
    guardedReads.set(queryHash, promise);
    await query.cancel({ revert: true });
    if (guardedReads.get(queryHash) === promise) {
      guardedReads.delete(queryHash);
      if (!intents.some((intent) => intent.mailboxId === mailboxId)) {
        base.delete(queryHash);
      }
    }
    stopObservingIfIdle();
  };

  const render = (
    mailboxId: string,
    update?: () => void,
    interrupted?: Set<string>
  ) => {
    rendering = true;
    try {
      notifyManager.batch(() => {
        const snapshots = [...base].filter(
          ([, snapshot]) => getQueryMailboxId(snapshot.key) === mailboxId
        );
        for (const [hash, snapshot] of snapshots) {
          const query = cache.get(hash);
          if (query && query.state.data !== snapshot.data) {
            client.setQueryData(snapshot.key, snapshot.data, {
              updatedAt: snapshot.updatedAt,
            });
          }
        }
        if (update) {
          update();
          for (const query of cache.getAll()) {
            if (getQueryMailboxId(query.queryKey) !== mailboxId) {
              continue;
            }
            const { data, dataUpdatedAt } = query.state;
            if (data === undefined) {
              continue;
            }
            const hash = query.queryHash;
            const changed = data !== base.get(hash)?.data;
            base.set(hash, {
              data,
              key: query.queryKey,
              updatedAt: dataUpdatedAt,
            });
            if (!interrupted || !changed) {
              continue;
            }
            if (query.state.fetchStatus !== "idle") {
              interrupted.add(hash);
              void guardRead(query, mailboxId);
            }
            void persistQueryByKey(query.queryKey, client);
          }
        }
        for (const intent of intents) {
          if (intent.mailboxId === mailboxId) {
            intent.apply?.();
          }
        }
      });
    } finally {
      rendering = false;
    }
  };

  const settle = async (intent: Intent) => {
    let outcome:
      | { kind: "resolved"; confirm: (() => void) | undefined }
      | { kind: "rejected"; error: unknown };
    try {
      outcome = { confirm: await intent.execute(), kind: "resolved" };
    } catch (error) {
      outcome = { error, kind: "rejected" };
    }
    if (disposed || !intents.includes(intent)) {
      return;
    }
    const { mailboxId } = intent;
    const catchUp = catchUps.get(mailboxId) ?? {
      interrupted: new Set<string>(),
      targets: new Set<string>(),
    };
    for (const target of intent.targets) {
      catchUp.targets.add(target);
    }
    catchUps.set(mailboxId, catchUp);
    versions.set(mailboxId, (versions.get(mailboxId) ?? 0) + 1);
    intents = intents.filter((entry) => entry !== intent);
    render(
      mailboxId,
      outcome.kind === "resolved" ? outcome.confirm : undefined,
      catchUp.interrupted
    );
    pendingMailMutations.set(
      client,
      new Set(intents.map((entry) => entry.mailboxId))
    );
    if (!intents.some((entry) => entry.mailboxId === mailboxId)) {
      for (const [hash, snapshot] of base) {
        if (
          getQueryMailboxId(snapshot.key) === mailboxId &&
          !guardedReads.has(hash)
        ) {
          base.delete(hash);
        }
      }
      void flushMailPersistence(client, mailboxId);
      queueMicrotask(() => {
        if (
          disposed ||
          catchUps.get(mailboxId) !== catchUp ||
          intents.some((entry) => entry.mailboxId === mailboxId)
        ) {
          return;
        }
        catchUps.delete(mailboxId);
        if (listeners.size > 0) {
          for (const listener of listeners) {
            listener(mailboxId, [...catchUp.targets]);
          }
          return;
        }
        void client.invalidateQueries(
          {
            predicate: ({ queryKey, queryHash }) =>
              catchUp.interrupted.has(queryHash) ||
              queryKey[0] === "gmail-unread-counts" ||
              queryKey[0] === "mailboxes",
          },
          { cancelRefetch: false }
        );
      });
    }
    stopObservingIfIdle();
    if (outcome.kind === "resolved") {
      intent.resolve();
    } else {
      intent.reject(outcome.error);
    }
  };

  const drain = () => {
    if (disposed) {
      return;
    }
    for (const [index, intent] of intents.entries()) {
      if (
        intent.started ||
        intents.slice(0, index).some((previous) => overlaps(previous, intent))
      ) {
        continue;
      }
      intent.started = true;
      void (async () => {
        await settle(intent);
        drain();
      })();
    }
  };

  const run = async (input: IntentInput) => {
    if (disposed) {
      throw new DOMException("Session ended", "AbortError");
    }
    const previous = intents.findLast((intent) => overlaps(intent, input));
    if (
      input.coalesceKey !== undefined &&
      previous?.coalesceKey === input.coalesceKey &&
      !previous.started
    ) {
      previous.apply = input.apply;
      previous.execute = input.execute;
      render(input.mailboxId);
      await previous.promise;
      return;
    }
    // oxlint-disable-next-line typescript/no-invalid-void-type -- The deferred promise resolves without a value.
    const deferred = Promise.withResolvers<void>();
    intents = [...intents, { ...input, ...deferred, started: false }];
    pendingMailMutations.set(
      client,
      new Set(intents.map((intent) => intent.mailboxId))
    );
    for (const query of cache.getAll()) {
      if (
        getQueryMailboxId(query.queryKey) === input.mailboxId &&
        query.state.data !== undefined &&
        !base.has(query.queryHash)
      ) {
        base.set(query.queryHash, {
          data: query.state.data,
          key: query.queryKey,
          updatedAt: query.state.dataUpdatedAt,
        });
      }
    }
    unsubscribe ??= cache.subscribe((event) => {
      if (rendering) {
        return;
      }
      const { query } = event;
      const hash = query.queryHash;
      if (event.type === "removed") {
        base.delete(hash);
        guardedReads.delete(hash);
        return;
      }
      if (event.type !== "updated" || event.action.type !== "success") {
        return;
      }
      const key: unknown = query.queryKey;
      if (!Array.isArray(key)) {
        return;
      }
      const mailboxId = getQueryMailboxId(key);
      if (typeof mailboxId !== "string") {
        return;
      }
      if (
        guardedReads.has(hash) &&
        guardedReads.get(hash) === query.promise &&
        event.action.manual !== true
      ) {
        render(mailboxId);
        return;
      }
      if (
        intents.some((intent) => intent.mailboxId === mailboxId) ||
        guardedReads.has(hash)
      ) {
        base.set(hash, {
          data: query.state.data,
          key,
          updatedAt: query.state.dataUpdatedAt,
        });
        render(mailboxId);
      }
    });
    render(input.mailboxId);
    queueMicrotask(drain);
    await deferred.promise;
  };
  return {
    dispose() {
      disposed = true;
      unsubscribe?.();
      for (const intent of intents) {
        intent.reject(new DOMException("Session ended", "AbortError"));
      }
      intents = [];
      base.clear();
      catchUps.clear();
      guardedReads.clear();
      listeners.clear();
      versions.clear();
      pendingMailMutations.delete(client);
      deferredMailPersistence.delete(client);
    },
    disposeMailbox(mailboxId: string) {
      const discarded = intents.filter(
        (intent) => intent.mailboxId === mailboxId
      );
      intents = intents.filter((intent) => intent.mailboxId !== mailboxId);
      catchUps.delete(mailboxId);
      versions.set(mailboxId, (versions.get(mailboxId) ?? 0) + 1);
      if (discarded.length > 0) {
        render(mailboxId);
      }
      for (const [hash, snapshot] of base) {
        if (getQueryMailboxId(snapshot.key) === mailboxId) {
          base.delete(hash);
          guardedReads.delete(hash);
        }
      }
      for (const [hash, key] of deferredMailPersistence.get(client) ?? []) {
        if (getQueryMailboxId(key) === mailboxId) {
          deferredMailPersistence.get(client)?.delete(hash);
        }
      }
      pendingMailMutations.get(client)?.delete(mailboxId);
      for (const intent of discarded) {
        intent.reject(new DOMException("Mailbox access changed", "AbortError"));
      }
      stopObservingIfIdle();
    },
    getVersion(mailboxId: string) {
      return versions.get(mailboxId) ?? 0;
    },
    run,
    subscribe(listener: CatchUpListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateFromServer<T>(
      key: QueryKey,
      updater: (data: T | undefined) => T | undefined
    ) {
      const mailboxId = getQueryMailboxId(key);
      if (disposed) {
        return;
      }
      if (
        typeof mailboxId === "string" &&
        intents.some((intent) => intent.mailboxId === mailboxId)
      ) {
        render(mailboxId, () => {
          client.setQueryData<T>(key, updater);
        });
      } else {
        client.setQueryData<T>(key, updater);
      }
    },
  };
};

export type MailMutationCoordinator = ReturnType<typeof createCoordinator>;

const getCoordinator = (client: QueryClient) => {
  let coordinator = mailMutationCoordinators.get(client);
  if (!coordinator) {
    coordinator = createCoordinator(client);
    mailMutationCoordinators.set(client, coordinator);
  }
  return coordinator;
};

export const disposeMailMutations = (client: QueryClient) => {
  mailMutationCoordinators.get(client)?.dispose();
};

export const disposeMailboxMutations = (
  client: QueryClient,
  mailboxId: string
) => {
  getCoordinator(client).disposeMailbox(mailboxId);
};

export const getMailMutationVersion = (
  client: QueryClient,
  mailboxId: string
) => mailMutationCoordinators.get(client)?.getVersion(mailboxId) ?? 0;

export const subscribeToMailMutationCatchUp = (
  client: QueryClient,
  listener: CatchUpListener
) => getCoordinator(client).subscribe(listener);

export const runMailMutation = async (
  client: QueryClient,
  input: IntentInput
) => {
  await getCoordinator(client).run(input);
};

export const updateMailQueryFromServer = <T>(
  client: QueryClient,
  key: QueryKey,
  updater: (data: T | undefined) => T | undefined
) => {
  const coordinator = mailMutationCoordinators.get(client);
  if (coordinator) {
    coordinator.updateFromServer(key, updater);
  } else {
    client.setQueryData<T>(key, updater);
  }
};
