"use client";

import { ColorModeProvider, Toaster } from "@quietr/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type PropsWithChildren, useState } from "react";
import { createQueryClient } from "~/lib/query-client";
import { createAppTrpcClient, TRPCProvider } from "~/lib/trpc";

export const Providers = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(createQueryClient);
  const [trpcClient] = useState(createAppTrpcClient);

  return (
    <NuqsAdapter>
      <ColorModeProvider initialColorMode="system">
        <QueryClientProvider client={queryClient}>
          <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
            {children}
            <Toaster />
          </TRPCProvider>
        </QueryClientProvider>
      </ColorModeProvider>
    </NuqsAdapter>
  );
};
