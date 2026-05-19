"use client";

import { PostHogProvider } from "@posthog/react";
import { useLocation } from "@tanstack/react-router";
import { SpeedInsights } from "@vercel/speed-insights/react";
import posthog from "posthog-js";
import { type PropsWithChildren, useEffect, useRef } from "react";
import { authClient } from "~/lib/auth";

const posthogToken =
  import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim() ||
  import.meta.env.VITE_PUBLIC_POSTHOG_TOKEN?.trim();
const posthogHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com";
const appEnvironment = import.meta.env.MODE;

const isPostHogEnabled = typeof window !== "undefined" && !!posthogToken;

if (isPostHogEnabled && !posthog.__loaded) {
  posthog.init(posthogToken, {
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
  });
}

export const TelemetryProvider = ({ children }: PropsWithChildren) => {
  const sessionState = authClient.useSession();
  const user = sessionState.data?.user;
  const userEmail = user?.email;
  const userId = user?.id ?? null;
  const userName = user?.name;
  const locationHref = useLocation({
    select: (location) => location.href,
  });
  const identifiedUserId = useRef<string | null>(null);
  const trackedLocationHref = useRef<string | null>(null);

  useEffect(() => {
    if (!isPostHogEnabled || trackedLocationHref.current === locationHref) {
      return;
    }

    posthog.capture("$pageview", {
      $current_url: new URL(locationHref, window.location.origin).toString(),
      app_environment: appEnvironment,
    });
    trackedLocationHref.current = locationHref;
  }, [locationHref]);

  useEffect(() => {
    if (!isPostHogEnabled) {
      return;
    }

    if (userId) {
      if (identifiedUserId.current !== userId) {
        posthog.identify(userId, {
          email: userEmail,
          name: userName,
        });
        identifiedUserId.current = userId;
      }

      return;
    }

    if (!sessionState.isPending && identifiedUserId.current) {
      posthog.reset();
      identifiedUserId.current = null;
    }
  }, [sessionState.isPending, userEmail, userId, userName]);

  if (!isPostHogEnabled) {
    return (
      <>
        {children}
        <SpeedInsights />
      </>
    );
  }

  return (
    <PostHogProvider client={posthog}>
      {children}
      <SpeedInsights />
    </PostHogProvider>
  );
};
