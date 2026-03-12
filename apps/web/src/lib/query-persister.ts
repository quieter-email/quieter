import type { QueryClient, QueryKey } from "@tanstack/react-query";
import {
  experimental_createQueryPersister,
  type AsyncStorage,
} from "@tanstack/query-persist-client-core";

const QUERY_PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const QUERY_PERSIST_PREFIX = "quietr-query";

type BrowserQueryStorage = AsyncStorage<string>;

const createBrowserQueryStorage = (): BrowserQueryStorage | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const storage = window.localStorage;

    return {
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

const queryPersister = experimental_createQueryPersister({
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
