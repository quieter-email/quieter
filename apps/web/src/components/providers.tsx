"use client";

import { ColorModeProvider, Toaster } from "@quieter/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { type PropsWithChildren, useState } from "react";
import { queryPersister } from "~/lib/query-persister";

export const Providers = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: 1000 * 60 * 30,
            persister: queryPersister.persisterFn,
          },
        },
      }),
  );

  return (
    <ColorModeProvider initialColorMode="system">
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster />
        </QueryClientProvider>
      </MotionConfig>
    </ColorModeProvider>
  );
};
