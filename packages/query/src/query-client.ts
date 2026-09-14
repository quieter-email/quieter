import { QueryClient } from "@tanstack/react-query";

import { shouldRetryOrpcError } from "./retry";

export const APP_QUERY_GC_TIME_MS = 1000 * 60 * 30;
export const APP_QUERY_STALE_TIME_MS = 1000 * 30;

/**
 * Shared query-client defaults for every client shell. Web keeps its own
 * persister-aware client; native and desktop shells start here.
 */
export const createAppQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        gcTime: APP_QUERY_GC_TIME_MS,
        retry: shouldRetryOrpcError,
        staleTime: APP_QUERY_STALE_TIME_MS,
      },
    },
  });
