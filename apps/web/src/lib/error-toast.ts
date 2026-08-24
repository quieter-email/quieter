import { toast } from "@quieter/ui/toast";
import * as Sentry from "@sentry/tanstackstart-react";

import { isExpectedClientError } from "#/lib/client-error-reporting";

/**
 * Surfaces a failed action as a toast: server-written messages are shown for
 * user-driven errors (validation, authorization, credits); anything else gets
 * a generic retry message and, unless it is an expected state, a report.
 */
export const toastError = (
  error: unknown,
  {
    boundary,
    fallback = "Something went wrong. Please try again.",
  }: { boundary?: string; fallback?: string } = {}
) => {
  let current: unknown = error;
  const visited = new Set<unknown>();
  while (
    current !== null &&
    current !== undefined &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    const candidate = current as {
      cause?: unknown;
      message?: unknown;
      status?: unknown;
    };
    if (typeof candidate.status === "number") {
      if (
        candidate.status >= 400 &&
        candidate.status < 500 &&
        typeof candidate.message === "string" &&
        candidate.message.trim().length > 0
      ) {
        toast.error(candidate.message);
        return;
      }
      break;
    }
    current = candidate.cause;
  }

  if (!isExpectedClientError(error)) {
    Sentry.captureException(
      error,
      ...(boundary === undefined ? [] : [{ tags: { boundary } }])
    );
  }
  toast.error(fallback);
};
