import { notifyManager } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { createStore } from "@tanstack/react-store";

import { pendingMailMutations } from "./mail-mutation-state";

type Intent = {
  mailboxId: string;
  targets: string[];
  coalesceKey?: string;
  apply: () => void;
  execute: () => Promise<() => void>;
  started: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
  promise: Promise<void>;
};

const coordinators = new WeakMap<
  QueryClient,
  ReturnType<typeof createCoordinator>
>();

const createCoordinator = (client: QueryClient) => {
  const state = createStore<Intent[]>([]);
  const base = new Map<
    string,
    { key: QueryKey; data: unknown; updatedAt: number }
  >();
  let disposed = false;
  let rendering = false;
  let unsubscribe: (() => void) | undefined;

  const capture = () => {
    for (const query of client.getQueryCache().getAll()) {
      const mailboxId =
        query.queryKey[0] === "message-thread"
          ? query.queryKey[2]
          : query.queryKey[1];
      if (
        (query.queryKey[0] === "messages" ||
          query.queryKey[0] === "message-thread") &&
        state.get().some((intent) => intent.mailboxId === mailboxId) &&
        !base.has(query.queryHash)
      ) {
        base.set(query.queryHash, {
          data: query.state.data,
          key: query.queryKey,
          updatedAt: query.state.dataUpdatedAt,
        });
      }
    }
  };
  const render = (confirm?: () => void) => {
    rendering = true;
    try {
      notifyManager.batch(() => {
        for (const snapshot of base.values()) {
          if (snapshot.data === undefined) {
            client.removeQueries({ exact: true, queryKey: snapshot.key });
            continue;
          }
          client.setQueryData(snapshot.key, snapshot.data, {
            updatedAt: snapshot.updatedAt,
          });
        }
        if (confirm) {
          confirm();
          for (const [hash, snapshot] of base) {
            const query = client.getQueryCache().get(hash);
            base.set(hash, {
              ...snapshot,
              data: query?.state.data,
              updatedAt: query?.state.dataUpdatedAt ?? snapshot.updatedAt,
            });
          }
        }
        for (const intent of state.get()) {
          intent.apply();
        }
      });
    } finally {
      rendering = false;
    }
  };
  const drain = () => {
    if (disposed) {
      return;
    }
    const intents = state.get();
    for (const [index, intent] of intents.entries()) {
      if (
        intent.started ||
        intents
          .slice(0, index)
          .some(
            (previous) =>
              previous.mailboxId === intent.mailboxId &&
              previous.targets.some((id) => intent.targets.includes(id))
          )
      ) {
        continue;
      }
      intent.started = true;
      // oxlint-disable-next-line no-loop-func -- Each intent is block scoped; disposal and the subscription are intentionally shared.
      void (async () => {
        let confirm: (() => void) | undefined;
        let failure: unknown;
        try {
          confirm = await intent.execute();
        } catch (error) {
          failure = error;
        }
        if (disposed) {
          return;
        }
        await client.cancelQueries(
          {
            predicate: ({ queryKey }) =>
              (queryKey[0] === "messages" &&
                queryKey[1] === intent.mailboxId) ||
              (queryKey[0] === "message-thread" &&
                queryKey[2] === intent.mailboxId),
          },
          { revert: false }
        );
        if (disposed) {
          return;
        }
        state.setState((current) =>
          current.filter((entry) => entry !== intent)
        );
        render(confirm);
        pendingMailMutations.set(
          client,
          new Set(state.get().map((entry) => entry.mailboxId))
        );
        if (state.get().length === 0) {
          unsubscribe?.();
          unsubscribe = undefined;
          base.clear();
        }
        if (failure === undefined) {
          intent.resolve();
        } else {
          intent.reject(failure);
        }
        if (
          !state.get().some((entry) => entry.mailboxId === intent.mailboxId)
        ) {
          void client.invalidateQueries(
            {
              predicate: ({ queryKey }) =>
                (queryKey[0] === "messages" &&
                  queryKey[1] === intent.mailboxId) ||
                (queryKey[0] === "message-thread" &&
                  queryKey[2] === intent.mailboxId) ||
                queryKey[0] === "gmail-unread-counts",
            },
            { cancelRefetch: true }
          );
        }
        drain();
      })();
    }
  };

  const run = async (
    input: Pick<
      Intent,
      "mailboxId" | "targets" | "apply" | "execute" | "coalesceKey"
    >
  ) => {
    if (disposed) {
      throw new DOMException("Session ended", "AbortError");
    }
    const queued =
      input.coalesceKey === undefined
        ? undefined
        : state
            .get()
            .findLast(
              (intent) =>
                !intent.started &&
                intent.mailboxId === input.mailboxId &&
                intent.coalesceKey === input.coalesceKey
            );
    if (queued) {
      queued.apply = input.apply;
      queued.execute = input.execute;
      render();
      await queued.promise;
      return;
    }
    // oxlint-disable-next-line typescript/no-invalid-void-type -- The deferred promise resolves without a value.
    const deferred = Promise.withResolvers<void>();
    const intent: Intent = { ...input, ...deferred, started: false };
    state.setState((current) => [...current, intent]);
    pendingMailMutations.set(
      client,
      new Set(state.get().map((entry) => entry.mailboxId))
    );
    capture();
    unsubscribe ??= client.getQueryCache().subscribe((event) => {
      if (
        rendering ||
        event.type !== "updated" ||
        event.action.type !== "success"
      ) {
        return;
      }
      const snapshot = base.get(event.query.queryHash);
      if (snapshot) {
        base.set(event.query.queryHash, {
          ...snapshot,
          data: event.query.state.data,
          updatedAt: event.query.state.dataUpdatedAt,
        });
      }
      capture();
      render();
    });
    render();
    queueMicrotask(drain);
    await deferred.promise;
  };
  return {
    dispose() {
      disposed = true;
      unsubscribe?.();
      for (const intent of state.get()) {
        intent.reject(new DOMException("Session ended", "AbortError"));
      }
      state.setState(() => []);
      base.clear();
      pendingMailMutations.delete(client);
    },
    run,
    updateFromServer(update: () => void) {
      if (!disposed) {
        render(update);
      }
    },
  };
};

export const disposeMailMutations = (client: QueryClient) => {
  coordinators.get(client)?.dispose();
};

export const runMailMutation = async (
  client: QueryClient,
  input: Parameters<ReturnType<typeof createCoordinator>["run"]>[0]
) => {
  let coordinator = coordinators.get(client);
  if (!coordinator) {
    coordinator = createCoordinator(client);
    coordinators.set(client, coordinator);
  }
  await coordinator.run(input);
};

export const updateMailQueryFromServer = <T>(
  client: QueryClient,
  key: QueryKey,
  updater: (data: T | undefined) => T | undefined
) => {
  const coordinator = coordinators.get(client);
  if (coordinator) {
    coordinator.updateFromServer(() => {
      client.setQueryData<T>(key, updater);
    });
  } else {
    client.setQueryData<T>(key, updater);
  }
};
