"use client";

import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";

const AtmosphericBackground = lazy(
  async () =>
    await import("#/components/atmospheric-background").then(
      ({ AtmosphericBackground: Component }) => ({
        default: Component,
      })
    )
);

const BlackFallback = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 bg-black" />
);

export const HomeAtmosphericBackground = (
  props: ComponentProps<typeof AtmosphericBackground>
) => (
  <Suspense fallback={<BlackFallback />}>
    <AtmosphericBackground {...props} />
  </Suspense>
);
