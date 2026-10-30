import { clientEnv } from "@quieter/app/env";
import { authClient, configureAppAuthClient } from "@quieter/app/lib/auth";
import { shouldDiscardClientError } from "@quieter/app/lib/client-error-reporting";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { toastError } from "@quieter/app/lib/error-toast";
import { clearQueryPersistence } from "@quieter/app/lib/query-persister";
import { configureAppRuntime } from "@quieter/app/runtime";
import { prepareReportedEvent } from "@quieter/observability";
import { ColorModeProvider } from "@quieter/ui/color-mode";
import { Toaster } from "@quieter/ui/toaster";
import * as Sentry from "@sentry/react";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { DESKTOP_TITLE_BAR_HEIGHT } from "../shared/bridge";
import { DesktopShell } from "./desktop-shell";
import { router } from "./router";

import "./styles.css";

Sentry.init({
  beforeSend: (event, hint) =>
    shouldDiscardClientError(event, hint.originalException)
      ? null
      : prepareReportedEvent(event, hint.originalException),
  dsn: clientEnv.VITE_SENTRY_DSN,
  enabled:
    clientEnv.VITE_SENTRY_DSN !== undefined &&
    (!import.meta.env.DEV || clientEnv.VITE_QUIETER_LOCAL_TELEMETRY === "true"),
  environment: import.meta.env.DEV ? "development" : "production",
});

configureAppRuntime({
  apiBaseURL: window.quieterDesktop.apiBaseURL,
  openExternal: window.quieterDesktop.openExternal,
  platform: "desktop",
});
configureAppAuthClient({ baseURL: window.quieterDesktop.apiBaseURL });
document.documentElement.dataset.platform = window.quieterDesktop.platform;
document.documentElement.style.setProperty(
  "--desktop-title-bar-height",
  `${DESKTOP_TITLE_BAR_HEIGHT}px`
);

const SessionEvents = () => {
  const { refetch } = authClient.useSession();
  useEffect(() => {
    const refreshSession = async () => {
      try {
        await refetch({ query: { disableCookieCache: true } });
        await router.invalidate();
      } catch (error) {
        toastError(error);
      }
    };
    const refresh = () => {
      void refreshSession();
    };
    const stopAuthenticated = window.onAuthenticated(refresh);
    const stopUserUpdated = window.onUserUpdated(async (user) => {
      if (user === null) {
        try {
          draftRecoveryJournal.setUser(undefined);
        } catch (error) {
          toastError(error, { boundary: "compose-recovery-identity-cleanup" });
        }
        try {
          await clearQueryPersistence();
        } catch (error) {
          toastError(error, { boundary: "desktop-sign-out-cache" });
        }
      }
      await refreshSession();
    });
    window.addEventListener("focus", refresh);
    return () => {
      stopAuthenticated();
      stopUserUpdated();
      window.removeEventListener("focus", refresh);
    };
  }, [refetch]);
  return null;
};

const root = document.querySelector("#root");
if (!root) {
  throw new Error("The application root is missing.");
}

createRoot(root).render(
  <ColorModeProvider initialColorMode="system">
    <MotionConfig reducedMotion="user">
      <SessionEvents />
      <DesktopShell>
        <RouterProvider router={router} />
      </DesktopShell>
      <Toaster />
    </MotionConfig>
  </ColorModeProvider>
);
