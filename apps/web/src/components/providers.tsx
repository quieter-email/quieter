"use client";

import { ColorModeProvider } from "@quieter/ui/color-mode";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { lazy, Suspense, useEffect, useMemo } from "react";
import type { PropsWithChildren } from "react";

import { ConsentManager } from "#/components/consent-manager";
import { MailtoProtocolHandler } from "#/components/mailto-protocol-handler";
import { SiteFooter } from "#/components/site-footer";
import { TelemetryProvider } from "#/components/telemetry-provider";
import { KeyboardShortcutsProvider } from "#/features/hotkeys/components/keyboard-shortcuts-context";
import { authClient } from "#/lib/auth";
import { shouldRetryOrpcError } from "#/lib/orpc-errors";
import { setQueryPersistenceUser } from "#/lib/query-persister";

const Toaster = lazy(
  async () =>
    await import("@quieter/ui/toaster").then(({ Toaster: Component }) => ({
      default: Component,
    }))
);

const QueryPersistenceSessionBoundary = () => {
  const session = authClient.useSession();

  useEffect(() => {
    if (!session.isPending) {
      setQueryPersistenceUser(session.data?.user.id);
    }
  }, [session.data?.user.id, session.isPending]);

  return null;
};

export const Providers = ({ children }: PropsWithChildren) => {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: {
            gcTime: 1000 * 60 * 30,
            retry: shouldRetryOrpcError,
          },
        },
        mutationCache: new MutationCache(),
        queryCache: new QueryCache(),
      }),
    []
  );

  const pathname = useLocation({
    select: (location) => location.pathname,
  });

  return (
    <ColorModeProvider
      forcedTheme={pathname === "/home" ? "dark" : undefined}
      initialColorMode="system"
    >
      <MotionConfig reducedMotion="user">
        <HotkeysProvider
          defaultOptions={{
            hotkey: {
              preventDefault: true,
              stopPropagation: true,
            },
            hotkeySequence: {
              preventDefault: true,
              stopPropagation: true,
            },
          }}
        >
          <ConsentManager>
            <TelemetryProvider>
              <QueryClientProvider client={queryClient}>
                <QueryPersistenceSessionBoundary />
                <KeyboardShortcutsProvider>
                  <MailtoProtocolHandler />
                  {children}
                  <Suspense fallback={null}>
                    <Toaster />
                  </Suspense>
                </KeyboardShortcutsProvider>
              </QueryClientProvider>
            </TelemetryProvider>
            <SiteFooter />
          </ConsentManager>
        </HotkeysProvider>
      </MotionConfig>
    </ColorModeProvider>
  );
};
