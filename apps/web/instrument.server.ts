import { serverEnv } from "@quieter/env/server";
import { prepareReportedEvent } from "@quieter/observability";
import type { CloudflareOptions } from "@sentry/cloudflare";

export const createServerSentryOptions = (
  runtimeEnv: unknown
): CloudflareOptions => {
  const bindings =
    typeof runtimeEnv === "object" && runtimeEnv !== null ? runtimeEnv : {};
  const boundDsn =
    "SENTRY_DSN" in bindings &&
    typeof bindings.SENTRY_DSN === "string" &&
    bindings.SENTRY_DSN !== ""
      ? bindings.SENTRY_DSN
      : undefined;
  const dsn = boundDsn ?? serverEnv.SENTRY_DSN;
  const environment =
    "SENTRY_ENVIRONMENT" in bindings &&
    typeof bindings.SENTRY_ENVIRONMENT === "string" &&
    bindings.SENTRY_ENVIRONMENT !== ""
      ? bindings.SENTRY_ENVIRONMENT
      : (serverEnv.SENTRY_ENVIRONMENT ??
        serverEnv.QUIETER_DEPLOYMENT_ENV ??
        serverEnv.NODE_ENV);
  const enabled =
    (serverEnv.NODE_ENV !== "development" ||
      serverEnv.VITE_QUIETER_LOCAL_TELEMETRY === true) &&
    dsn !== undefined;

  return {
    beforeSend: (event, hint) =>
      prepareReportedEvent(event, hint.originalException),
    dataCollection: {
      cookies: false,
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
      httpBodies: [],
      httpHeaders: { request: false, response: false },
      stackFrameVariables: false,
      urlQueryParams: false,
      userInfo: false,
    },
    dsn,
    enableLogs: false,
    enabled,
    environment,
    release:
      typeof __QUIETER_BUILD_ID__ === "string"
        ? __QUIETER_BUILD_ID__
        : undefined,
    tracesSampleRate: 0,
  };
};
