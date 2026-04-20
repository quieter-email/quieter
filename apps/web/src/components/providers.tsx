"use client";

import { ColorModeProvider, Toaster } from "@quietr/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { type PropsWithChildren, useState } from "react";
import { createQueryClient } from "~/lib/query-client";

export const Providers = ({ children }: PropsWithChildren) => {
  const [queryClient] = useState(createQueryClient);

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
