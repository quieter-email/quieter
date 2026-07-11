"use client";

import { useConsentManager } from "@c15t/react";
import { useLocation } from "@tanstack/react-router";
import { type PropsWithChildren, useEffect, useRef } from "react";
import { authClient } from "~/lib/auth";

const appEnvironment = import.meta.env.MODE;

type PosthogClient = {
  capture?: (event: string, properties?: Record<string, unknown>) => void;
  identify?: (userId: string, properties?: Record<string, unknown>) => void;
  reset?: () => void;
};

const getPosthogClient = (): PosthogClient | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return (window.posthog as PosthogClient | undefined) ?? null;
};

export const TelemetryProvider = ({ children }: PropsWithChildren) => {
  const { has, hasConsented } = useConsentManager();
  const measurementConsented = hasConsented() && has("measurement");
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
    if (!measurementConsented) {
      trackedLocationHref.current = null;
      return;
    }

    if (trackedLocationHref.current === locationHref) {
      return;
    }

    const posthog = getPosthogClient();
    if (!posthog?.capture) {
      return;
    }

    posthog.capture("$pageview", {
      $current_url: new URL(locationHref, window.location.origin).toString(),
      app_environment: appEnvironment,
    });
    trackedLocationHref.current = locationHref;
  }, [locationHref, measurementConsented]);

  useEffect(() => {
    if (!measurementConsented) {
      getPosthogClient()?.reset?.();
      identifiedUserId.current = null;
      return;
    }

    const posthog = getPosthogClient();
    if (!posthog) {
      return;
    }

    if (userId) {
      if (identifiedUserId.current !== userId && posthog.identify) {
        posthog.identify(userId, {
          email: userEmail,
          name: userName,
        });
        identifiedUserId.current = userId;
      }

      return;
    }

    if (!sessionState.isPending && identifiedUserId.current && posthog.reset) {
      posthog.reset();
      identifiedUserId.current = null;
    }
  }, [measurementConsented, sessionState.isPending, userEmail, userId, userName]);

  return children;
};
