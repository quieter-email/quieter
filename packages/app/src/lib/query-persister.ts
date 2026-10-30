import { mailCache, MAIL_CACHE_MAX_AGE } from "@quieter/app/lib/mail-cache";
import {
  deferredMailPersistence,
  mailMutationCoordinators,
  pendingMailMutations,
} from "@quieter/app/lib/mail-mutation-state";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import type { PersistedQuery } from "@tanstack/query-persist-client-core";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

const isPersistedQuery = (value: unknown): value is PersistedQuery => {
  if (
    !(typeof value === "object" && value !== null) ||
    typeof Reflect.get(value, "buster") !== "string" ||
    typeof Reflect.get(value, "queryHash") !== "string" ||
    !Array.isArray(Reflect.get(value, "queryKey")) ||
    !("state" in value)
  ) {
    return false;
  }

  const state: unknown = value.state;
  if (typeof state !== "object" || state === null) {
    return false;
  }
  return (
    typeof Reflect.get(state, "dataUpdateCount") === "number" &&
    typeof Reflect.get(state, "dataUpdatedAt") === "number" &&
    typeof Reflect.get(state, "errorUpdateCount") === "number" &&
    typeof Reflect.get(state, "errorUpdatedAt") === "number" &&
    typeof Reflect.get(state, "fetchFailureCount") === "number" &&
    typeof Reflect.get(state, "isInvalidated") === "boolean" &&
    (Reflect.get(state, "status") === "pending" ||
      Reflect.get(state, "status") === "error" ||
      Reflect.get(state, "status") === "success") &&
    (Reflect.get(state, "fetchStatus") === "idle" ||
      Reflect.get(state, "fetchStatus") === "fetching" ||
      Reflect.get(state, "fetchStatus") === "paused")
  );
};

const deserializePersistedQuery = (value: string): PersistedQuery => {
  const parsed: unknown = JSON.parse(value);
  if (!isPersistedQuery(parsed)) {
    throw new Error("Invalid persisted query.");
  }
  return parsed;
};

let persistenceUser: string | undefined;
let persistenceGeneration = 0;
let persistenceSession: string | undefined;
let persistenceInitialized = false;
let persistenceClient: QueryClient | undefined;

const bodyCacheSchema = z.object({
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
});
const threadCacheSchema = z.looseObject({
  messages: z.array(
    z.looseObject({
      bodyHtml: z.string().optional(),
      bodyText: z.string().optional(),
      id: z.string(),
    })
  ),
});

const createPersister = (generation: number) => {
  const ownerClient = persistenceClient;
  const pendingWrites = new Set<Promise<void>>();
  const storage = {
    entries: async () =>
      generation === persistenceGeneration ? await mailCache.entries() : [],
    getItem: async (key: string) => {
      if (generation !== persistenceGeneration) {
        return null;
      }
      const value = await mailCache.getItem(key);
      return generation === persistenceGeneration ? value : null;
    },
    removeItem: async (key: string) => {
      if (generation === persistenceGeneration) {
        await mailCache.removeItem(key);
      }
    },
    setItem: async (key: string, value: string) => {
      if (generation === persistenceGeneration && value !== "") {
        const write = mailCache.setItem(key, value);
        pendingWrites.add(write);
        try {
          await write;
        } finally {
          pendingWrites.delete(write);
        }
      }
    },
  };
  const persister = experimental_createQueryPersister({
    buster: "v8",
    deserialize: async (value) => {
      const parsed = deserializePersistedQuery(value);
      if (
        parsed.queryKey[0] === "calendar" &&
        parsed.queryKey[1] !== persistenceUser
      ) {
        throw new Error("Calendar cache belongs to a different account.");
      }
      if (parsed.queryKey[0] === "message-thread") {
        const detail = threadCacheSchema.parse(parsed.state.data);
        let missingBody = false;
        const messages = await Promise.all(
          detail.messages.map(async (message) => {
            const body = await storage.getItem(
              `body-${JSON.stringify([parsed.queryKey[2], message.id])}`
            );
            if (!body) {
              missingBody = true;
            }
            return body
              ? { ...message, ...bodyCacheSchema.parse(JSON.parse(body)) }
              : message;
          })
        );
        return {
          ...parsed,
          state: {
            ...parsed.state,
            data: { ...detail, messages },
            dataUpdatedAt: missingBody ? 0 : parsed.state.dataUpdatedAt,
          },
        };
      }
      return parsed;
    },
    maxAge: MAIL_CACHE_MAX_AGE,
    prefix: "quieter-cache",
    serialize: async (query) => {
      const mailboxId =
        query.queryKey[0] === "message-thread"
          ? query.queryKey[2]
          : query.queryKey[1];
      if (
        generation !== persistenceGeneration ||
        (query.queryKey[0] === "calendar" &&
          query.queryKey[1] !== persistenceUser) ||
        (ownerClient &&
          typeof mailboxId === "string" &&
          pendingMailMutations.get(ownerClient)?.has(mailboxId) === true)
      ) {
        return "";
      }
      if (query.queryKey[0] === "message-thread") {
        const detail = threadCacheSchema.parse(query.state.data);
        for (const message of detail.messages) {
          if (
            message.bodyHtml !== undefined ||
            message.bodyText !== undefined
          ) {
            const key = `body-${JSON.stringify([query.queryKey[2], message.id])}`;
            const body = JSON.stringify({
              bodyHtml: message.bodyHtml,
              bodyText: message.bodyText,
            });
            if ((await storage.getItem(key)) !== body) {
              await storage.setItem(key, body);
            }
          }
        }
      }
      return JSON.stringify(query, (key, value: unknown) => {
        if (["bodyHtml", "bodyText", "headers", "raw"].includes(key)) {
          return undefined;
        }
        if ((key === "pages" || key === "pageParams") && Array.isArray(value)) {
          const pages: unknown[] = value;
          return pages.slice(0, 5);
        }
        return value;
      });
    },
    storage,
  });
  return {
    ...persister,
    persistQueryByKey: async (
      ...args: Parameters<typeof persister.persistQueryByKey>
    ) => {
      await persister.persistQueryByKey(...args);
      await Promise.all(pendingWrites);
    },
  };
};

let currentPersister = createPersister(persistenceGeneration);

export const queryPersister: ReturnType<
  typeof experimental_createQueryPersister
> = {
  persistQuery: async (query) => {
    if (persistenceClient?.getQueryCache().get(query.queryHash) === query) {
      await currentPersister.persistQuery(query);
    }
  },
  persistQueryByKey: async (key, client) => {
    if (persistenceClient === client) {
      await currentPersister.persistQueryByKey(key, client);
    }
  },
  persisterFn: async (queryFn, context, query) => {
    if (context.client !== persistenceClient) {
      return await queryFn(context);
    }
    const delegate = currentPersister;
    return await delegate.persisterFn(queryFn, context, query);
  },
  persisterGc: async (...args) => {
    await currentPersister.persisterGc(...args);
  },
  removeQueries: async (...args) => {
    await currentPersister.removeQueries(...args);
  },
  restoreQueries: async (client, ...args) => {
    if (client === persistenceClient) {
      await currentPersister.restoreQueries(client, ...args);
    }
  },
  retrieveQuery: async (...args) =>
    await currentPersister.retrieveQuery(...args),
};

let logoutChannel: BroadcastChannel | undefined;

const updatePersistenceOwner = (
  userId: string | undefined,
  client?: QueryClient,
  sessionId?: string
) => {
  persistenceInitialized = true;
  if (persistenceClient) {
    mailMutationCoordinators.get(persistenceClient)?.dispose();
    deferredMailPersistence.delete(persistenceClient);
  }
  persistenceUser = userId;
  persistenceSession = sessionId;
  persistenceClient = client;
  persistenceGeneration += 1;
  currentPersister = createPersister(persistenceGeneration);
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("quieter-cache:") === true) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    /* Browser storage access may be denied. */
  }
};

export const setQueryPersistenceUser = (
  userId: string | null | undefined,
  client?: QueryClient,
  sessionId = userId ?? undefined
) => {
  if (
    typeof window === "undefined" ||
    (persistenceInitialized &&
      persistenceUser === (userId ?? undefined) &&
      persistenceClient === client &&
      persistenceSession === sessionId)
  ) {
    return;
  }
  try {
    if (!logoutChannel && typeof window.BroadcastChannel === "function") {
      logoutChannel = new window.BroadcastChannel("quieter-cache-logout");
      logoutChannel.addEventListener(
        "message",
        (event: MessageEvent<unknown>) => {
          if (
            typeof event.data === "string" &&
            event.data === persistenceSession
          ) {
            const previousClient = persistenceClient;
            updatePersistenceOwner(undefined);
            mailCache.detach();
            previousClient?.clear();
          }
        }
      );
    }
  } catch {
    /* The browser may deny cross-tab messaging. */
  }
  updatePersistenceOwner(userId ?? undefined, client, sessionId);
  void mailCache.setUser(persistenceUser, sessionId);
};

export const clearQueryPersistence = async (
  scope: "all" | "session" = "all"
) => {
  const previousSession = persistenceSession;
  const previousClient = persistenceClient;
  updatePersistenceOwner(undefined);
  previousClient?.clear();
  if (scope === "session") {
    await mailCache.clearSession();
  } else {
    await mailCache.clear();
  }
  try {
    if (previousSession) {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel messages are restricted to the same origin and accept no targetOrigin.
      logoutChannel?.postMessage(previousSession);
    }
  } catch {
    /* The browser may deny cross-tab messaging. */
  }
};

export const shouldPersistQueryKey = (queryKey: readonly unknown[]) => {
  if (queryKey[0] === "calendar") {
    return (
      typeof queryKey[1] === "string" &&
      queryKey[1].length > 0 &&
      ((queryKey.length === 3 && queryKey[2] === "accounts") ||
        (queryKey[2] === "connection" &&
          typeof queryKey[3] === "string" &&
          queryKey[3].length > 0 &&
          ((queryKey.length === 5 && queryKey[4] === "calendars") ||
            (queryKey.length === 8 &&
              queryKey[4] === "calendar" &&
              typeof queryKey[5] === "string" &&
              queryKey[5].length > 0 &&
              ((queryKey[6] === "event" &&
                typeof queryKey[7] === "string" &&
                queryKey[7].length > 0) ||
                (queryKey[6] === "events" &&
                  typeof queryKey[7] === "object" &&
                  queryKey[7] !== null))))))
    );
  }
  if (queryKey[0] === "message-thread" && queryKey.length === 4) {
    return (
      typeof queryKey[2] === "string" &&
      queryKey[2].length > 0 &&
      typeof queryKey[3] === "string"
    );
  }
  if (queryKey.length === 2) {
    return (
      (queryKey[0] === "gmail-labels" ||
        queryKey[0] === "managed-label-counts") &&
      typeof queryKey[1] === "string" &&
      queryKey[1].length > 0
    );
  }

  return (
    queryKey.length === 4 &&
    queryKey[0] === "messages" &&
    typeof queryKey[1] === "string" &&
    queryKey[1].length > 0 &&
    typeof queryKey[2] === "string" &&
    queryKey[2] !== "drafts" &&
    queryKey[3] === ""
  );
};

export const removeCalendarScopePersistence = async (
  userId: string,
  connectionId: string,
  calendarId?: string
) => {
  if (persistenceUser !== userId) {
    return;
  }
  persistenceGeneration += 1;
  currentPersister = createPersister(persistenceGeneration);
  await mailCache.removeCalendarScope(connectionId, calendarId);
  if (calendarId === undefined) {
    await queryPersister.removeQueries({
      queryKey: ["calendar", userId, "accounts"],
    });
  }
};

export const restoreMissingCalendarScopeQueries = async (
  client: QueryClient,
  userId: string,
  connectionId: string,
  calendarId: string
) => {
  if (persistenceUser !== userId || persistenceClient !== client) {
    return;
  }
  for (const [storageKey, value] of await mailCache.entries()) {
    if (!storageKey.startsWith("quieter-cache-")) {
      continue;
    }
    let stored: PersistedQuery;
    try {
      stored = deserializePersistedQuery(value);
    } catch {
      continue;
    }
    const key = stored.queryKey;
    if (
      key[0] !== "calendar" ||
      key[1] !== userId ||
      key[2] !== "connection" ||
      key[3] !== connectionId ||
      !(
        (key.length === 5 && key[4] === "calendars") ||
        (key.length === 8 &&
          key[4] === "calendar" &&
          key[5] === calendarId &&
          (key[6] === "event" || key[6] === "events"))
      ) ||
      storageKey !== `quieter-cache-${stored.queryHash}` ||
      client.getQueryData(key) !== undefined
    ) {
      continue;
    }
    const data = await queryPersister.retrieveQuery<unknown>(stored.queryHash);
    if (persistenceUser !== userId || persistenceClient !== client) {
      return;
    }
    if (data !== undefined && client.getQueryData(key) === undefined) {
      client.setQueryData(key, data, { updatedAt: stored.state.dataUpdatedAt });
    }
  }
};

export const persistQueryByKey = async (
  queryKey: readonly unknown[] | undefined,
  queryClient: Parameters<typeof queryPersister.persistQueryByKey>[1]
) => {
  if (
    persistenceClient !== queryClient ||
    !queryKey ||
    !shouldPersistQueryKey(queryKey)
  ) {
    return;
  }
  const mailboxId =
    queryKey[0] === "message-thread" ? queryKey[2] : queryKey[1];
  if (
    typeof mailboxId === "string" &&
    pendingMailMutations.get(queryClient)?.has(mailboxId) === true
  ) {
    let keys = deferredMailPersistence.get(queryClient);
    if (!keys) {
      keys = new Map();
      deferredMailPersistence.set(queryClient, keys);
    }
    keys.set(JSON.stringify(queryKey), queryKey);
    return;
  }
  try {
    await queryPersister.persistQueryByKey(queryKey, queryClient);
  } catch {
    /* Persistence is optional. */
  }
};

export const flushMailPersistence = async (
  client: QueryClient,
  mailboxId: string
) => {
  const keys = deferredMailPersistence.get(client);
  if (!keys || pendingMailMutations.get(client)?.has(mailboxId) === true) {
    return;
  }
  const ready: (readonly unknown[])[] = [];
  for (const [hash, key] of keys) {
    if ((key[0] === "message-thread" ? key[2] : key[1]) === mailboxId) {
      keys.delete(hash);
      ready.push(key);
    }
  }
  await Promise.all(
    ready.map(async (key) => {
      await persistQueryByKey(key, client);
    })
  );
};
