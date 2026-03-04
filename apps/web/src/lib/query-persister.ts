import type { QueryClient, QueryKey } from "@tanstack/solid-query";
import { experimental_createQueryPersister } from "@tanstack/query-persist-client-core";
import { isServer } from "solid-js/web";

const QUERY_PERSIST_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

const queryPersister = experimental_createQueryPersister({
  storage: isServer ? undefined : localStorage,
  refetchOnRestore: "always",
  maxAge: QUERY_PERSIST_MAX_AGE_MS,
});

export const queryPersisterFn = queryPersister.persisterFn;

export const persistQueryByKey = async (
  queryClient: QueryClient,
  queryKey: QueryKey,
): Promise<void> => {
  if (isServer) return;

  try {
    await queryPersister.persistQueryByKey(queryKey, queryClient);
  } catch {
    return;
  }
};
