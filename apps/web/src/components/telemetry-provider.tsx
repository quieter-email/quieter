"use client";

import { useConsentManager } from "@c15t/react";
import { useLocation } from "@tanstack/react-router";
import { type PropsWithChildren, useEffect, useRef, useSyncExternalStore } from "react";
import { getPosthogClient, getPosthogReady, subscribeToPosthogReady } from "~/lib/posthog";

const appEnvironment = import.meta.env.MODE;

export const TelemetryProvider = ({ children }: PropsWithChildren) => {
  const { has, hasConsented } = useConsentManager();
  const measurementConsented = hasConsented() && has("measurement");
  const posthogReady = useSyncExternalStore(subscribeToPosthogReady, getPosthogReady, () => false);
  const pathname = useLocation({
    select: (location) => location.pathname,
  });
  const trackedPathname = useRef<string | null>(null);

  useEffect(() => {
    if (!measurementConsented) {
      trackedPathname.current = null;
      return;
    }

    if (!posthogReady || trackedPathname.current === pathname) {
      return;
    }

    const posthog = getPosthogClient();
    if (!posthog?.capture) {
      return;
    }

    posthog.capture("$pageview", {
      $current_url: new URL(pathname, window.location.origin).toString(),
      app_environment: appEnvironment,
      app_route: pathname,
    });
    trackedPathname.current = pathname;
  }, [measurementConsented, pathname, posthogReady]);

  return children;
};
