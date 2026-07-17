"use client";

import { ColorModeProvider } from "@quieter/ui/color-mode";
import { Toaster } from "@quieter/ui/toast";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { type PropsWithChildren, useEffect, useState } from "react";
import { ConsentManager } from "~/components/consent-manager";
import { FocusModalityProvider } from "~/components/focus-modality-provider";
import { MailtoProtocolHandler } from "~/components/mailto-protocol-handler";
import { SiteFooter } from "~/components/site-footer";
import { TelemetryProvider } from "~/components/telemetry-provider";
import { KeyboardShortcutsProvider } from "~/features/hotkeys/components/keyboard-shortcuts-context";
import { authClient } from "~/lib/auth";
import { shouldRetryOrpcError } from "~/lib/orpc-errors";
import { setQueryPersistenceUser } from "~/lib/query-persister";

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
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache(),
        queryCache: new QueryCache(),
        defaultOptions: {
          queries: {
            gcTime: 1000 * 60 * 30,
            retry: shouldRetryOrpcError,
          },
          mutations: { retry: false },
        },
      }),
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
                <FocusModalityProvider>
                  <KeyboardShortcutsProvider>
                    <MailtoProtocolHandler />
                    {children}
                    <Toaster />
                  </KeyboardShortcutsProvider>
                </FocusModalityProvider>
              </QueryClientProvider>
            </TelemetryProvider>
            <SiteFooter />
          </ConsentManager>
        </HotkeysProvider>
      </MotionConfig>
    </ColorModeProvider>
  );
};
