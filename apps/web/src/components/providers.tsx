"use client";

import { ColorModeProvider, Toaster } from "@quieter/ui";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { type PropsWithChildren, useState } from "react";
import { redirectToGoogleScopeRepair, shouldRetryOrpcError } from "~/lib/orpc-errors";

export const Providers = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({
          onError: redirectToGoogleScopeRepair,
        }),
        queryCache: new QueryCache({
          onError: redirectToGoogleScopeRepair,
        }),
        defaultOptions: {
          queries: {
            gcTime: 1000 * 60 * 30,
            retry: shouldRetryOrpcError,
          },
          mutations: {
            retry: shouldRetryOrpcError,
          },
        },
      }),
  );

  const pathname = useLocation({
    select: (location) => location.pathname,
  });

  return (
    <ColorModeProvider
      forcedTheme={pathname === "/home" ? "light" : undefined}
      initialColorMode="system"
    >
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster />
        </QueryClientProvider>
      </MotionConfig>
    </ColorModeProvider>
  );
};
