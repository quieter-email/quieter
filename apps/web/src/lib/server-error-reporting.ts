import { serverEnv } from "@quieter/env/server";
import { configureErrorReporter } from "@quieter/observability";
import type { ErrorContext } from "@quieter/observability";
import * as Sentry from "@sentry/cloudflare";

export const reportServerError = (
  error: unknown,
  boundary: string,
  context: ErrorContext = {}
) => {
  if (serverEnv.QUIETER_DEPLOYMENT_ENV === "local") {
    // oxlint-disable-next-line no-console -- Local failures must remain visible when remote reporting is disabled.
    console.error(`[${boundary}]`, error);
  }
  const tags: Record<string, boolean | number | string> = { boundary };
  for (const key of [
    "errorType",
    "model",
    "operation",
    "phase",
    "provider",
    "requestLength",
    "retryable",
    "statusCode",
  ] as const) {
    const value = context[key];
    if (value !== undefined) {
      tags[key] = value;
    }
  }

  let current: unknown = error;
  const visited = new Set<unknown>();
  while (
    typeof current === "object" &&
    current !== null &&
    !visited.has(current)
  ) {
    visited.add(current);
    if (
      !("statusCode" in tags) &&
      "statusCode" in current &&
      typeof current.statusCode === "number"
    ) {
      tags.statusCode = current.statusCode;
    }
    if (
      !("retryable" in tags) &&
      "isRetryable" in current &&
      typeof current.isRetryable === "boolean"
    ) {
      tags.retryable = current.isRetryable;
    }
    if (
      context.errorType === undefined &&
      "name" in current &&
      typeof current.name === "string" &&
      current.name !== ""
    ) {
      tags.errorType = current.name;
    }
    if ("lastError" in current && current.lastError !== undefined) {
      current = current.lastError;
    } else if ("cause" in current) {
      current = current.cause;
    } else {
      current = undefined;
    }
  }

  Sentry.captureException(error, { tags });
};

configureErrorReporter((error, context) => {
  const { boundary: explicitBoundary, operation } = context;
  let boundary = "application";
  if (typeof operation === "string") {
    boundary = operation;
  }
  if (typeof explicitBoundary === "string") {
    boundary = explicitBoundary;
  }
  reportServerError(error, boundary, context);
});
