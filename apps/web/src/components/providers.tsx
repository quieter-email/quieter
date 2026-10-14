"use client";

import { ColorModeProvider } from "@quieter/ui/color-mode";
import { Toaster } from "@quieter/ui/toaster";
import { useLocation } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import type { PropsWithChildren } from "react";

import { ConsentManager } from "#/components/consent-manager";
import { TelemetryProvider } from "#/components/telemetry-provider";

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
