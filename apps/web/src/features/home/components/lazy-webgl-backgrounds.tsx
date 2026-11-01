"use client";

import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";

const AtmosphericBackground = lazy(
  async () =>
    await import("@quieter/app/components/atmospheric-background").then(
      ({ AtmosphericBackground: Component }) => ({
        default: Component,
      })
    )
);

const CanvasFallback = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 bg-canvas" />
);

export const HomeAtmosphericBackground = (
  props: ComponentProps<typeof AtmosphericBackground>
) => (
  <Suspense fallback={<CanvasFallback />}>
    <AtmosphericBackground {...props} />
  </Suspense>
);
