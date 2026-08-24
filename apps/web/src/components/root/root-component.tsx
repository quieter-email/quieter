import { Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { Providers } from "#/components/providers";

import { RootDocument } from "./root-document";

// Deferred on purpose: the worker memory boundary forbids the router graph
// from eagerly pulling in the WebGL background.
const WorkspaceDitherBackground = lazy(
  async () =>
    await import("#/components/workspace-dither-background").then(
      ({ WorkspaceDitherBackground: Component }) => ({ default: Component })
    )
);

export const RootComponent = () => (
  <RootDocument>
    <Providers>
      <Suspense fallback={null}>
        <WorkspaceDitherBackground className="fixed -z-10" />
      </Suspense>
      <Outlet />
    </Providers>
  </RootDocument>
);
