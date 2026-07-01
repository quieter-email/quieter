"use client";

import type { PropsWithChildren } from "react";
import { ConsentManagerProvider } from "@c15t/react";
import { posthog } from "@c15t/scripts/posthog";
import { ConsentBanner } from "~/components/consent/consent-banner";
import { consentEnglishI18n, consentLegalLinks } from "~/components/consent/consent-i18n";
import { ConsentPreferencesDialog } from "~/components/consent/consent-preferences-dialog";
import { clientEnv } from "~/env";

const posthogToken = clientEnv.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = clientEnv.VITE_PUBLIC_POSTHOG_HOST;

export const ConsentManager = ({ children }: PropsWithChildren) => {
  const scripts = posthogToken
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
    : [];

  return (
    <ConsentManagerProvider
      options={{
        consentCategories: ["necessary", "measurement"],
        i18n: consentEnglishI18n,
        legalLinks: consentLegalLinks,
        mode: "offline",
        scripts,
      }}
    >
      <ConsentBanner />
      <ConsentPreferencesDialog />
      {children}
    </ConsentManagerProvider>
  );
};
