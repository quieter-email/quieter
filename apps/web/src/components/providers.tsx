"use client";

import { ColorModeProvider, Toaster } from "@quietr/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type PropsWithChildren, useState } from "react";
import { createQueryClient } from "~/lib/query-client";

export const Providers = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(createQueryClient);

  return (
    <NuqsAdapter>
      <ColorModeProvider initialColorMode="system">
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster />
        </QueryClientProvider>
      </ColorModeProvider>
    </NuqsAdapter>
  );
};
