import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  experimental_createQueryPersister,
  type AsyncStorage,
  type PersistedQuery,
} from "@tanstack/query-persist-client-core";

const QUERY_PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const QUERY_PERSIST_BUSTER = "v2";
const QUERY_PERSIST_PREFIX = "quieter-query";

type BrowserQueryStorage = AsyncStorage<string>;

const createBrowserQueryStorage = (): BrowserQueryStorage | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const storage = window.localStorage;

    return {
      entries: async () => {
        const entries: Array<[string, string]> = [];

        for (let index = 0; index < storage.length; index += 1) {
          try {
            const key = storage.key(index);
            if (!key) {
              continue;
            }

            const value = storage.getItem(key);
            if (value === null) {
              continue;
            }

            entries.push([key, value]);
          } catch {
            continue;
          }
        }

        return entries;
      },
      getItem: (key) => {
        try {
          return storage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key, value) => {
        try {
          storage.setItem(key, value);
        } catch {
          return;
        }
      },
      removeItem: (key) => {
        try {
          storage.removeItem(key);
        } catch {
          return;
        }
      },
    };
  } catch {
    return undefined;
  }
};

const browserQueryStorage = createBrowserQueryStorage();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

const isThreadQueryKey = (queryKey: QueryKey) => queryKey[0] === "message-thread";

const hasRenderableThreadBodies = (data: unknown): boolean => {
  if (!isRecord(data)) {
    return false;
  }

  const messages = data.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }

  return messages.every((message) => {
    if (!isRecord(message)) {
      return false;
    }

    if (!hasText(message.snippet)) {
      return true;
    }

    return hasText(message.bodyHtml) || hasText(message.bodyText);
  });
};

const deserializePersistedQuery = (cachedString: string): PersistedQuery => {
  const persistedQuery = JSON.parse(cachedString) as PersistedQuery;

  if (
    isThreadQueryKey(persistedQuery.queryKey) &&
    !hasRenderableThreadBodies(persistedQuery.state.data)
  ) {
    return {
      ...persistedQuery,
      buster: `${persistedQuery.buster}:invalid-thread-content`,
    };
  }

  return persistedQuery;
};

const queryPersister = experimental_createQueryPersister({
  buster: QUERY_PERSIST_BUSTER,
  deserialize: deserializePersistedQuery,
  storage: browserQueryStorage,
  refetchOnRestore: false,
  maxAge: QUERY_PERSIST_MAX_AGE_MS,
  prefix: QUERY_PERSIST_PREFIX,
});

export const queryPersisterFn = queryPersister.persisterFn;

export const persistQueryByKey = async (queryClient: QueryClient, queryKey: QueryKey) => {
  if (!browserQueryStorage) {
    return;
  }

  try {
    await queryPersister.persistQueryByKey(queryKey, queryClient);
  } catch {
    return;
  }
};

export const clearPersistedQueryCache = async () => {
  try {
    await queryPersister.removeQueries();
  } catch {
    return;
  }
};
