import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";

const QUERY_PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const isBrowser = typeof window !== "undefined";

const queryPersister = experimental_createQueryPersister({
  storage: isBrowser ? window.localStorage : undefined,
  refetchOnRestore: true,
  maxAge: QUERY_PERSIST_MAX_AGE_MS,
});

export const queryPersisterFn = queryPersister.persisterFn;

export const persistQueryByKey = async (queryClient: QueryClient, queryKey: QueryKey) => {
  if (!isBrowser) {
    return;
  }

  try {
    await queryPersister.persistQueryByKey(queryKey, queryClient);
  } catch {
    return;
  }
};
