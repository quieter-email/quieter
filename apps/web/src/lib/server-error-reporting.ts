import { configureErrorReporter } from "@quieter/observability";
import * as Sentry from "@sentry/tanstackstart-react";

export const reportServerError = (error: unknown, boundary: string) => {
  const reportableError = new Error(
    error instanceof Error ? error.message : String(error)
  );

  if (error instanceof Error) {
    reportableError.name = error.name;
    reportableError.stack = error.stack;
  }

  Sentry.captureException(reportableError, {
    tags: { boundary },
  });
};

configureErrorReporter((error, context) => {
  const boundary =
    typeof context.boundary === "string" ? context.boundary : "application";
  reportServerError(error, boundary);
});
