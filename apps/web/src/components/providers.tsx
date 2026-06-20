"use client";

import { ColorModeProvider, Toaster } from "@quieter/ui";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { type PropsWithChildren, useState } from "react";
import { ConsentManager } from "~/components/consent-manager";
import { SiteFooter } from "~/components/site-footer";
import { TelemetryProvider } from "~/components/telemetry-provider";
import { shouldRetryOrpcError } from "~/lib/orpc-errors";

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
        <ConsentManager>
          <TelemetryProvider>
            <QueryClientProvider client={queryClient}>
              {children}
              <Toaster />
            </QueryClientProvider>
          </TelemetryProvider>
          <SiteFooter />
        </ConsentManager>
      </MotionConfig>
    </ColorModeProvider>
  );
};
