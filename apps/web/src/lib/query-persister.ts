import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";

export const PERSISTED_QUERY_MAX_AGE_MS = 1000 * 60 * 60 * 24;

const queryStorage =
  typeof window === "undefined"
    ? undefined
    : {
        entries: () => Object.entries(window.localStorage),
        getItem: (key: string) => window.localStorage.getItem(key),
        removeItem: (key: string) => window.localStorage.removeItem(key),
        setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
      };

export const queryPersister = experimental_createQueryPersister({
  buster: "v5",
  maxAge: PERSISTED_QUERY_MAX_AGE_MS,
  prefix: "quieter-cache",
  storage: queryStorage,
});

export const shouldPersistQueryKey = (queryKey: readonly unknown[]) => {
  if (queryKey.length === 1) {
    return queryKey[0] === "mailboxes";
  }

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
