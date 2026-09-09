"use client";

import { useConsentManager } from "@c15t/react";
import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PropsWithChildren } from "react";

import { subscribeMailSyncMeasurements } from "#/lib/mail-sync/measurements";
import {
  getPosthogClient,
  getPosthogReady,
  subscribeToPosthogReady,
} from "#/lib/posthog";

const appEnvironment = import.meta.env.MODE;

export const TelemetryProvider = ({ children }: PropsWithChildren) => {
  const { has, hasConsented } = useConsentManager();
  const measurementConsented = hasConsented() && has("measurement");
  const posthogReady = useSyncExternalStore(
    subscribeToPosthogReady,
    getPosthogReady,
    () => false
  );
  const pathname = useLocation({
    select: (location) => location.pathname,
  });
  const trackedPathname = useRef<string | null>(null);

  useEffect((): (() => void) | undefined => {
    if (!measurementConsented || !posthogReady) {
      return undefined;
    }
    const pending = new Map<
      string,
      { count: number; total: number; max: number }
    >();
    const unsubscribe = subscribeMailSyncMeasurements((name, value) => {
      const entry = pending.get(name) ?? { count: 0, max: 0, total: 0 };
      entry.count += 1;
      entry.total += value;
      entry.max = Math.max(entry.max, value);
      pending.set(name, entry);
    });
    const flush = setInterval(() => {
      if (pending.size === 0) {
        return;
      }
      getPosthogClient()?.capture?.("mail_sync_performance", {
        $current_url: window.location.origin,
        $pathname: "/",
        $referrer: "",
        ...Object.fromEntries(
          [...pending].flatMap(([name, entry]) => [
            [`${name}_count`, entry.count],
            [`${name}_total`, entry.total],
            [`${name}_max`, entry.max],
          ])
        ),
      });
      pending.clear();
    }, 60_000);
    return () => {
      unsubscribe();
      clearInterval(flush);
    };
  }, [measurementConsented, posthogReady]);

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
