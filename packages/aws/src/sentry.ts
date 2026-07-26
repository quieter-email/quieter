import { serverEnv } from "@quieter/env/server";
import * as Sentry from "@sentry/node";

const enabled = serverEnv.NODE_ENV !== "development" && !!serverEnv.SENTRY_DSN;

if (enabled) {
  Sentry.init({
    dsn: serverEnv.SENTRY_DSN,
    enableLogs: false,
    environment:
      serverEnv.SENTRY_ENVIRONMENT ?? serverEnv.QUIETER_DEPLOYMENT_ENV ?? serverEnv.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

export const reportAwsError = async (error: unknown, handler: string) => {
  if (!enabled) return;

  try {
    Sentry.withScope((scope) => {
      scope.setTag("handler", handler);
      scope.setTag("runtime", "aws-lambda");
      Sentry.captureException(error);
    });
    await Sentry.flush(2_000);
  } catch (reportingError) {
    console.error(
      "Could not report AWS handler error.",
      reportingError instanceof Error ? reportingError.message : "Unknown error.",
    );
  }
};

export const withSentry =
  <Arguments extends unknown[], Result>(
    handlerName: string,
    handler: (...args: Arguments) => Promise<Result>,
  ) =>
  async (...args: Arguments) => {
    try {
      return await handler(...args);
    } catch (error) {
      await reportAwsError(error, handlerName);
      throw error;
    }
  };
