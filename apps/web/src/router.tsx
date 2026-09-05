import * as Sentry from "@sentry/tanstackstart-react";
import { createRouter } from "@tanstack/react-router";

import { RootErrorComponent } from "./components/root/root-error-component";
import { RootNotFoundComponent } from "./components/root/root-not-found-component";
import { clientEnv } from "./env";
import { shouldDiscardClientError } from "./lib/client-error-reporting";
import { handleDeploymentPreloadError } from "./lib/stale-deployment";
import { routeTree } from "./routeTree.gen";

const isSentryEnabled =
  !import.meta.env.DEV &&
  clientEnv.VITE_SENTRY_DSN !== undefined &&
  clientEnv.VITE_SENTRY_DSN !== "";

export const getRouter = () => {
  const router = createRouter({
    // Without these, only the root route gets the branded screens and every
    // other route falls back to the router's built-in error markup.
    defaultErrorComponent: RootErrorComponent,
    defaultNotFoundComponent: RootNotFoundComponent,
    defaultPendingMinMs: 0,
    routeTree,
    scrollRestoration: true,
  });

  if (!router.isServer) {
    window.addEventListener("vite:preloadError", handleDeploymentPreloadError);
  }

  if (!router.isServer && isSentryEnabled) {
    Sentry.init({
      beforeSend: (event, hint) =>
        shouldDiscardClientError(event, hint.originalException) ? null : event,
      dsn: clientEnv.VITE_SENTRY_DSN,
      enableLogs: false,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.05,
    });
  }

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
