import { clientEnv } from "@quieter/app/env";
import { shouldDiscardClientError } from "@quieter/app/lib/client-error-reporting";
import * as Sentry from "@sentry/react";
import { createRouter } from "@tanstack/react-router";

import { RouteError } from "#/components/route-error";
import { RouteNotFound } from "#/components/route-not-found";

import { routeTree } from "./routeTree.gen";

const isSentryEnabled =
  (!import.meta.env.DEV || clientEnv.VITE_QUIETER_LOCAL_TELEMETRY === "true") &&
  clientEnv.VITE_SENTRY_DSN !== undefined &&
  clientEnv.VITE_SENTRY_DSN !== "";

export const getRouter = () => {
  const router = createRouter({
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: RouteNotFound,
    defaultPendingMinMs: 0,
    routeTree,
    scrollRestoration: true,
  });

  if (!router.isServer && isSentryEnabled) {
    Sentry.init({
      beforeSend: (event, hint) =>
        shouldDiscardClientError(event, hint.originalException) ? null : event,
      dsn: clientEnv.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0,
    });
  }

  return router;
};

declare module "@tanstack/react-router" {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack's registry is an augmented interface.
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
