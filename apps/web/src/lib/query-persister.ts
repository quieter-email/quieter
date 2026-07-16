import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";

export const PERSISTED_QUERY_MAX_AGE_MS = 1000 * 60 * 60 * 24;

let persistenceUserId = "anonymous";
let persistenceDisabled = false;
const CACHE_NAMESPACE = "quieter-cache:v7";
const getStorageKey = (key: string) => `${CACHE_NAMESPACE}:${persistenceUserId}:${key}`;

export const setQueryPersistenceUser = (userId: string | null | undefined) => {
  const nextUserId = userId?.trim() || "anonymous";
  if (nextUserId === persistenceUserId || typeof window === "undefined") return;
  persistenceUserId = nextUserId;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (
      key?.startsWith(`${CACHE_NAMESPACE}:`) &&
      !key.startsWith(`${CACHE_NAMESPACE}:${nextUserId}:`)
    ) {
      window.localStorage.removeItem(key);
    }
  }
};

const queryStorage =
  typeof window === "undefined"
    ? undefined
    : {
        entries: () => {
          const prefix = `${CACHE_NAMESPACE}:${persistenceUserId}:`;
          return Object.entries(window.localStorage).flatMap<[string, string]>(([key, value]) =>
            key.startsWith(prefix) ? [[key.slice(prefix.length), String(value)]] : [],
          );
        },
        getItem: (key: string) =>
          persistenceDisabled ? null : window.localStorage.getItem(getStorageKey(key)),
        removeItem: (key: string) => window.localStorage.removeItem(getStorageKey(key)),
        setItem: (key: string, value: string) => {
          if (persistenceDisabled) return;
          try {
            window.localStorage.setItem(getStorageKey(key), value);
          } catch {
            const prefix = `${CACHE_NAMESPACE}:${persistenceUserId}:`;
            const oldestSummaryKey = Object.keys(window.localStorage).find(
              (storageKey) => storageKey.startsWith(prefix) && storageKey.includes("messages"),
            );
            if (!oldestSummaryKey) {
              persistenceDisabled = true;
              return;
            }
            window.localStorage.removeItem(oldestSummaryKey);
            try {
              window.localStorage.setItem(getStorageKey(key), value);
            } catch {
              persistenceDisabled = true;
            }
          }
        },
      };

export const queryPersister = experimental_createQueryPersister({
  buster: "v7",
  serialize: (persistedQuery) =>
    JSON.stringify(persistedQuery, (key, value: unknown) => {
      if (key === "bodyHtml" || key === "bodyText" || key === "headers" || key === "raw") {
        return undefined;
      }
      if ((key === "pages" || key === "pageParams") && Array.isArray(value)) {
        return value.slice(0, 2);
      }
      return value;
    }),
  deserialize: (value) => JSON.parse(value),
  maxAge: PERSISTED_QUERY_MAX_AGE_MS,
  prefix: "quieter-cache",
  storage: queryStorage,
});

export const shouldPersistQueryKey = (queryKey: readonly unknown[]) => {
  if (queryKey.length === 2) {
    return (
      (queryKey[0] === "gmail-labels" ||
        queryKey[0] === "managed-saved-views" ||
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
  queryClient: Parameters<typeof queryPersister.persistQueryByKey>[1],
) => {
  if (!queryKey || !shouldPersistQueryKey(queryKey)) return;
  await queryPersister.persistQueryByKey(queryKey, queryClient);
};
