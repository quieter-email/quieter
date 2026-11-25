import type { QueryClient } from "@tanstack/react-query";

import { subscribeQuerySessionInvalidation } from "./query-persister";

export const canPrefetchInBackground = () => {
  if (document.visibilityState !== "visible" || !navigator.onLine) {
    return false;
  }
  const connection = "connection" in navigator ? navigator.connection : null;
  return !(
    typeof connection === "object" &&
    connection !== null &&
    (("saveData" in connection && connection.saveData === true) ||
      ("effectiveType" in connection &&
        (connection.effectiveType === "slow-2g" ||
          connection.effectiveType === "2g")))
  );
};

export const hasForegroundWorkspaceFetches = (queryClient: QueryClient) =>
  queryClient.isFetching({
    predicate: ({ queryKey }) =>
      queryKey[0] === "messages" ||
      queryKey[0] === "message-thread" ||
      queryKey[0] === "calendar",
    type: "active",
  }) > 0;

export const scheduleBackgroundPrefetch = (
  queryClient: QueryClient,
  run: (signal: AbortSignal) => Promise<void>
) => {
  const controller = new AbortController();
  const unsubscribe = subscribeQuerySessionInvalidation(queryClient, () => {
    controller.abort();
  });
  let ready = false;
  let started = false;
  const start = () => {
    if (
      ready &&
      !controller.signal.aborted &&
      !started &&
      canPrefetchInBackground() &&
      !hasForegroundWorkspaceFetches(queryClient)
    ) {
      started = true;
      void Promise.allSettled([run(controller.signal)]);
    }
  };
  const timer = window.setTimeout(() => {
    ready = true;
    start();
  }, 350);
  const unsubscribeQueries = queryClient.getQueryCache().subscribe(start);
  const connection = "connection" in navigator ? navigator.connection : null;
  if (connection instanceof EventTarget) {
    connection.addEventListener("change", start);
  }
  window.addEventListener("online", start);
  document.addEventListener("visibilitychange", start);
  return () => {
    controller.abort();
    unsubscribe();
    unsubscribeQueries();
    if (connection instanceof EventTarget) {
      connection.removeEventListener("change", start);
    }
    window.clearTimeout(timer);
    window.removeEventListener("online", start);
    document.removeEventListener("visibilitychange", start);
  };
};
