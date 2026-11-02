"use client";

import { ConsentManager } from "@quieter/app/components/consent-manager";
import { TelemetryProvider } from "@quieter/app/components/telemetry-provider";
import { ColorModeProvider } from "@quieter/ui/color-mode";
import { Toaster } from "@quieter/ui/toaster";
import { useLocation } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import type { PropsWithChildren } from "react";

export const Providers = ({ children }: PropsWithChildren) => {
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
            {children}
            <Toaster />
          </TelemetryProvider>
        </ConsentManager>
      </MotionConfig>
    </ColorModeProvider>
  );
};
