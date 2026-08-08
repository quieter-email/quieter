"use client";

import { type ComponentProps, lazy, Suspense } from "react";

const AtmosphericBackground = lazy(() =>
  import("~/components/atmospheric-background").then(({ AtmosphericBackground: Component }) => ({
    default: Component,
  })),
);

const WorkspaceDitherBackground = lazy(() =>
  import("~/components/workspace-dither-background").then(
    ({ WorkspaceDitherBackground: Component }) => ({
      default: Component,
    }),
  ),
);

const BlackFallback = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 bg-black" />
);

export const preloadHomeWebglBackgrounds = () => {
  void import("~/components/atmospheric-background");
  void import("~/components/workspace-dither-background");
};

export const HomeAtmosphericBackground = (props: ComponentProps<typeof AtmosphericBackground>) => (
  <Suspense fallback={<BlackFallback />}>
    <AtmosphericBackground {...props} />
  </Suspense>
);

export const HomeWorkspaceDitherBackground = (
  props: ComponentProps<typeof WorkspaceDitherBackground>,
) => (
  <Suspense fallback={<BlackFallback />}>
    <WorkspaceDitherBackground {...props} />
  </Suspense>
);
