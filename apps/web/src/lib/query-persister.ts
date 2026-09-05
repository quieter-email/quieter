import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import type { PersistedQuery } from "@tanstack/query-persist-client-core";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPersistedQuery = (value: unknown): value is PersistedQuery => {
  if (
    !isRecord(value) ||
    typeof value.buster !== "string" ||
    typeof value.queryHash !== "string" ||
    !Array.isArray(value.queryKey) ||
    !isRecord(value.state)
  ) {
    return false;
  }

  const { state } = value;
  return (
    typeof state.dataUpdateCount === "number" &&
    typeof state.dataUpdatedAt === "number" &&
    typeof state.errorUpdateCount === "number" &&
    typeof state.errorUpdatedAt === "number" &&
    typeof state.fetchFailureCount === "number" &&
    typeof state.isInvalidated === "boolean" &&
    (state.status === "pending" ||
      state.status === "error" ||
      state.status === "success") &&
    (state.fetchStatus === "idle" ||
      state.fetchStatus === "fetching" ||
      state.fetchStatus === "paused")
  );
};

const deserializePersistedQuery = (value: string): PersistedQuery => {
  const parsed: unknown = JSON.parse(value);
  if (!isPersistedQuery(parsed)) {
    throw new Error("Invalid persisted query.");
  }
  return parsed;
};

export const PERSISTED_QUERY_MAX_AGE_MS = 1000 * 60 * 60 * 24;

let persistenceUserId = "anonymous";
let persistenceUserInitialized = false;
let persistenceDisabled = false;
const CACHE_NAMESPACE = "quieter-cache:v7";
const getStorageKey = (key: string) =>
  `${CACHE_NAMESPACE}:${persistenceUserId}:${key}`;

const getPersistedTimestamp = (storedValue: string | null) => {
  if (storedValue === null || storedValue === "") {
    return 0;
  }

  try {
    const parsed: unknown = JSON.parse(storedValue);
    const record = isRecord(parsed) ? parsed : {};
    const { persistedAt, queryState, state } = record;
    if (typeof persistedAt === "number") {
      return persistedAt;
    }

    if (isRecord(queryState) && typeof queryState.dataUpdatedAt === "number") {
      return queryState.dataUpdatedAt;
    }

    return isRecord(state) && typeof state.dataUpdatedAt === "number"
      ? state.dataUpdatedAt
      : 0;
  } catch {
    return 0;
  }
};

const findOldestMessageStorageKey = (prefix: string) => {
  let oldestSummary: { storageKey: string; timestamp: number } | undefined;
  for (const storageKey of Object.keys(window.localStorage)) {
    if (!storageKey.startsWith(prefix) || !storageKey.includes("messages")) {
      continue;
    }

    const timestamp = getPersistedTimestamp(
      window.localStorage.getItem(storageKey)
    );
    if (oldestSummary === undefined || timestamp < oldestSummary.timestamp) {
      oldestSummary = { storageKey, timestamp };
    }
  }
  return oldestSummary?.storageKey;
};

export const setQueryPersistenceUser = (userId: string | null | undefined) => {
  const trimmedUserId = userId?.trim();
  const nextUserId =
    trimmedUserId === undefined || trimmedUserId === ""
      ? "anonymous"
      : trimmedUserId;
  if (typeof window === "undefined") {
    return;
  }
  if (persistenceUserInitialized && nextUserId === persistenceUserId) {
    return;
  }
  persistenceUserInitialized = true;
  persistenceUserId = nextUserId;
  persistenceDisabled = false;
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (
      key !== null &&
      key.startsWith(`${CACHE_NAMESPACE}:`) &&
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
          return Object.entries(window.localStorage).flatMap<[string, string]>(
            ([key, value]) =>
              key.startsWith(prefix)
                ? [[key.slice(prefix.length), String(value)]]
                : []
          );
        },
        getItem: (key: string) =>
          persistenceDisabled
            ? null
            : window.localStorage.getItem(getStorageKey(key)),
        removeItem: (key: string) => {
          window.localStorage.removeItem(getStorageKey(key));
        },
        setItem: (key: string, value: string) => {
          if (persistenceDisabled) {
            return;
          }
          try {
            window.localStorage.setItem(getStorageKey(key), value);
          } catch {
            const prefix = `${CACHE_NAMESPACE}:${persistenceUserId}:`;
            const oldestSummaryKey = findOldestMessageStorageKey(prefix);
            if (oldestSummaryKey === undefined) {
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
  deserialize: deserializePersistedQuery,
  maxAge: PERSISTED_QUERY_MAX_AGE_MS,
  prefix: "quieter-cache",
  serialize: (persistedQuery) =>
    JSON.stringify(persistedQuery, (key, value: unknown) => {
      if (
        key === "bodyHtml" ||
        key === "bodyText" ||
        key === "headers" ||
        key === "raw"
      ) {
        return undefined;
      }
      if ((key === "pages" || key === "pageParams") && Array.isArray(value)) {
        const firstTwo: unknown[] = [];
        for (const item of value) {
          if (firstTwo.length >= 2) {
            break;
          }
          firstTwo.push(item);
        }
        return firstTwo;
      }
      return value;
    }),
  storage: queryStorage,
});

export const shouldPersistQueryKey = (queryKey: readonly unknown[]) => {
  if (queryKey.length === 2) {
    return (
      (queryKey[0] === "gmail-labels" ||
        queryKey[0] === "saved-views" ||
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
  if (!queryKey || !shouldPersistQueryKey(queryKey)) {
    return;
  }
  await queryPersister.persistQueryByKey(queryKey, queryClient);
};
