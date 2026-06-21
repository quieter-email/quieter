import * as Sentry from "@sentry/tanstackstart-react";

export const reportServerError = (error: unknown, boundary: string) => {
  const reportableError = new Error(error instanceof Error ? error.message : String(error));

  if (error instanceof Error) {
    reportableError.name = error.name;
    reportableError.stack = error.stack;
  }

  console.error(reportableError.stack ?? reportableError.message);
  Sentry.captureException(reportableError, {
    tags: { boundary },
  });
};
