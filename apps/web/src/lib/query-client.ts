import { QueryClient } from "@tanstack/react-query";
import { queryPersisterFn } from "./query-persister";

const QUERY_GC_TIME_MS = 1000 * 60 * 30;

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: QUERY_GC_TIME_MS,
        persister: queryPersisterFn,
      },
    },
  });
