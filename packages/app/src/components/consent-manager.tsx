"use client";

import { ConsentProvider, offline } from "@c15t/react";
import { posthog } from "@c15t/scripts/posthog";
import { ConsentBanner } from "@quieter/app/components/consent/consent-banner";
import {
  consentEnglishI18n,
  consentLegalLinks,
} from "@quieter/app/components/consent/consent-i18n";
import { ConsentPreferencesDialog } from "@quieter/app/components/consent/consent-preferences-dialog";
import { clientEnv } from "@quieter/app/env";
import { markPosthogReady } from "@quieter/app/lib/posthog";
import type { PropsWithChildren } from "react";

const posthogToken = clientEnv.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogId =
  (!import.meta.env.DEV || clientEnv.VITE_QUIETER_LOCAL_TELEMETRY === "true") &&
  typeof posthogToken === "string" &&
  posthogToken !== ""
    ? posthogToken
    : null;
const configuredPosthogHost = clientEnv.VITE_PUBLIC_POSTHOG_HOST;
const posthogHost =
  typeof configuredPosthogHost === "string" && configuredPosthogHost !== ""
    ? configuredPosthogHost
    : "https://eu.i.posthog.com";
const consentMode = offline({
  policyRules: [
    {
      categories: ["measurement"],
      id: "quieter-measurement-opt-in",
      match: { isDefault: true },
      model: "opt-in",
      prompt: "choice",
      scopeMode: "strict",
    },
  ],
});
const posthogScript =
  posthogId === null
    ? null
    : posthog({
        apiHost: posthogHost,
        id: posthogId,
        initOptions: {
          api_host: posthogHost,
          autocapture: false,
          capture_dead_clicks: false,
          capture_exceptions: false,
          capture_pageleave: false,
          capture_pageview: false,
          cookieless_mode: "never",
          defaults: "2026-01-30",
          disable_session_recording: true,
          person_profiles: "never",
          ui_host: "https://eu.posthog.com",
        },
        loadMode: "after-consent",
        region: posthogHost.includes("eu.") ? "eu" : "us",
      });

if (posthogScript) {
  const initializePosthog = posthogScript.onLoad;
  posthogScript.onLoad = (info) => {
    initializePosthog?.(info);
    markPosthogReady();
  };
}

export const ConsentManager = ({ children }: PropsWithChildren) => (
  <ConsentProvider
    options={{
      consentCategories: ["necessary", "measurement"],
      i18n: consentEnglishI18n,
      legalLinks: consentLegalLinks,
      mode: consentMode,
      scripts: posthogScript ? [posthogScript] : [],
    }}
  >
    <ConsentBanner />
    <ConsentPreferencesDialog />
    {children}
  </ConsentProvider>
);
