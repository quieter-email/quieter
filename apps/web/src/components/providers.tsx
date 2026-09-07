"use client";

import { ColorModeProvider } from "@quieter/ui/color-mode";
import { Toaster } from "@quieter/ui/toaster";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { useLayoutEffect, useState } from "react";
import type { PropsWithChildren } from "react";

import { ConsentManager } from "#/components/consent-manager";
import { MailtoProtocolHandler } from "#/components/mailto-protocol-handler";
import { SiteFooter } from "#/components/site-footer";
import { TelemetryProvider } from "#/components/telemetry-provider";
import { KeyboardShortcutsProvider } from "#/features/hotkeys/components/keyboard-shortcuts-context";
import { authClient } from "#/lib/auth";
import { shouldRetryOrpcError } from "#/lib/orpc-errors";
import { setQueryPersistenceUser } from "#/lib/query-persister";

const SessionQueryProvider = ({
  children,
  userId,
}: PropsWithChildren<{ userId: string | undefined }>) => {
  // The client is owned for this provider lifetime and is never replaced by a setter.
  // oxlint-disable-next-line react/hook-use-state
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: {
            gcTime: 1000 * 60 * 30,
            retry: shouldRetryOrpcError,
          },
        },
      })
  );

  useLayoutEffect(() => {
    setQueryPersistenceUser(userId);
    return () => {
      queryClient.clear();
    };
  }, [queryClient, userId]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

export const Providers = ({ children }: PropsWithChildren) => {
  const session = authClient.useSession();
  const userId = session.data?.user.id;
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
              <SessionQueryProvider key={userId ?? "anonymous"} userId={userId}>
                <KeyboardShortcutsProvider>
                  <MailtoProtocolHandler />
                  {children}
                  <Toaster />
                </KeyboardShortcutsProvider>
              </SessionQueryProvider>
            </TelemetryProvider>
            <SiteFooter />
          </ConsentManager>
        </HotkeysProvider>
      </MotionConfig>
    </ColorModeProvider>
  );
};
