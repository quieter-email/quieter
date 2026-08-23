import { Outlet } from "@tanstack/react-router";

import { Providers } from "#/components/providers";
import { WorkspaceDitherBackground } from "#/components/workspace-dither-background";

import { RootDocument } from "./root-document";

export const RootComponent = () => (
  <RootDocument>
    <Providers>
      <WorkspaceDitherBackground className="fixed -z-10" />
      <Outlet />
    </Providers>
  </RootDocument>
);
