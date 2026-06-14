import * as Sentry from "@sentry/tanstackstart-react";
import { createRouter } from "@tanstack/react-router";
import { clientEnv } from "./env";
import { routeTree } from "./routeTree.gen";

const isSentryEnabled = !import.meta.env.DEV && !!clientEnv.VITE_SENTRY_DSN;

export function getRouter() {
  const router = createRouter({
    defaultPendingMinMs: 0,
    routeTree,
    scrollRestoration: true,
  });

  if (!router.isServer && isSentryEnabled) {
    Sentry.init({
      dsn: clientEnv.VITE_SENTRY_DSN,
      enableLogs: false,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
  }

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
