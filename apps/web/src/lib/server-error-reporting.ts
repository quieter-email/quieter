import { serverEnv } from "@quieter/env/server";
import { configureErrorReporter } from "@quieter/observability";
import type { ErrorContext } from "@quieter/observability";
import * as Sentry from "@sentry/tanstackstart-react";

export const reportServerError = (
  error: unknown,
  boundary: string,
  context: ErrorContext = {}
) => {
  if (serverEnv.QUIETER_DEPLOYMENT_ENV === "local") {
    // oxlint-disable-next-line no-console -- Local failures must remain visible when remote reporting is disabled.
    console.error(`[${boundary}]`, error);
  }
  Sentry.captureException(error, {
    extra: context,
    tags: { boundary },
  });
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
