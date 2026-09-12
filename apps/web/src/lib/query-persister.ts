import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import type { PersistedQuery } from "@tanstack/query-persist-client-core";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { mailCache, MAIL_CACHE_MAX_AGE } from "./mail-cache";
import {
  deferredMailPersistence,
  pendingMailMutations,
} from "./mail-mutation-state";

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
let persistenceEpoch = 0;
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

const createPersister = (epoch: number) => {
  const ownerClient = persistenceClient;
  const storage = {
    entries: async () =>
      epoch === persistenceEpoch ? await mailCache.entries() : [],
    getItem: async (key: string) =>
      epoch === persistenceEpoch ? await mailCache.getItem(key) : null,
    removeItem: async (key: string) => {
      if (epoch === persistenceEpoch) {
        await mailCache.removeItem(key);
      }
    },
    setItem: async (key: string, value: string) => {
      if (epoch === persistenceEpoch && value !== "") {
        await mailCache.setItem(key, value);
      }
    },
  };
  return experimental_createQueryPersister({
    buster: "v8",
    deserialize: async (value) => {
      const parsed = deserializePersistedQuery(value);
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
        epoch !== persistenceEpoch ||
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
};

let currentPersister = createPersister(persistenceEpoch);

export const queryPersister: ReturnType<
  typeof experimental_createQueryPersister
> = {
  persistQuery: async (...args) => {
    await currentPersister.persistQuery(...args);
  },
  persistQueryByKey: async (...args) => {
    await currentPersister.persistQueryByKey(...args);
  },
  persisterFn: async (queryFn, context, query) => {
    const delegate = currentPersister;
    return await delegate.persisterFn(queryFn, context, query);
  },
  persisterGc: async (...args) => {
    await currentPersister.persisterGc(...args);
  },
  removeQueries: async (...args) => {
    await currentPersister.removeQueries(...args);
  },
  restoreQueries: async (...args) => {
    await currentPersister.restoreQueries(...args);
  },
  retrieveQuery: async (...args) =>
    await currentPersister.retrieveQuery(...args),
};

export const setQueryPersistenceUser = (
  userId: string | null | undefined,
  client?: QueryClient
) => {
  if (
    typeof window === "undefined" ||
    (persistenceInitialized &&
      persistenceUser === (userId ?? undefined) &&
      persistenceClient === client)
  ) {
    return;
  }
  persistenceInitialized = true;
  if (persistenceClient) {
    deferredMailPersistence.delete(persistenceClient);
  }
  persistenceUser = userId ?? undefined;
  persistenceClient = client;
  persistenceEpoch += 1;
  mailCache.setUser(persistenceUser);
  currentPersister = createPersister(persistenceEpoch);
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("quieter-cache:") === true) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    /* Remove obsolete metadata when browser storage is available. */
  }
};

export const shouldPersistQueryKey = (queryKey: readonly unknown[]) => {
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
    queryKey[3] === ""
  );
};

export const persistQueryByKey = async (
  queryKey: readonly unknown[] | undefined,
  queryClient: Parameters<typeof queryPersister.persistQueryByKey>[1]
) => {
  if (
    (persistenceClient && persistenceClient !== queryClient) ||
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
    // Optional cache persistence must not change a server mutation outcome.
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
