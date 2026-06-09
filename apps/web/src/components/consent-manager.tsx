"use client";

import { ConsentBanner, ConsentDialog, ConsentManagerProvider } from "@c15t/react";
import { posthog } from "@c15t/scripts/posthog";
import { type PropsWithChildren, useMemo } from "react";

const posthogToken =
  import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim() ||
  import.meta.env.VITE_PUBLIC_POSTHOG_TOKEN?.trim();
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com";
const consentBackendUrl =
  import.meta.env.VITE_PUBLIC_C15T_URL?.trim() ||
  (typeof window !== "undefined" ? `${window.location.origin}/api/c15t` : "/api/c15t");

export const ConsentManager = ({ children }: PropsWithChildren) => {
  const scripts = useMemo(
    () =>
      posthogToken
        ? [
            posthog({
              apiHost: posthogHost,
              id: posthogToken,
              initOptions: {
                api_host: posthogHost,
                autocapture: false,
                capture_dead_clicks: false,
                capture_exceptions: false,
                capture_pageleave: false,
                capture_pageview: false,
                defaults: "2026-01-30",
                disable_session_recording: true,
                person_profiles: "identified_only",
                ui_host: "https://eu.posthog.com",
              },
              loadMode: "after-consent",
              region: posthogHost.includes("eu.") ? "eu" : "us",
            }),
          ]
        : [],
    [],
  );

  return (
    <ConsentManagerProvider
      options={{
        backendURL: consentBackendUrl,
        consentCategories: ["necessary", "measurement", "marketing"],
        mode: "hosted",
        scripts,
        ...(import.meta.env.DEV ? { overrides: { country: "DE" } } : {}),
      }}
    >
      <ConsentBanner />
      <ConsentDialog />
      {children}
    </ConsentManagerProvider>
  );
};
