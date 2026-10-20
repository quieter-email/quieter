import { authClient, configureAppAuthClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import { configureAppRuntime } from "@quieter/app/runtime";
import { ColorModeProvider } from "@quieter/ui/color-mode";
import { Toaster } from "@quieter/ui/toaster";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { DESKTOP_TITLE_BAR_HEIGHT } from "../shared/bridge";
import { DesktopShell } from "./desktop-shell";
import { router } from "./router";

import "./styles.css";

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
    const stopUserUpdated = window.onUserUpdated(refresh);
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
