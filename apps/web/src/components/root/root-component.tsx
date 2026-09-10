import { Outlet } from "@tanstack/react-router";

import { Providers } from "#/components/providers";

export const RootComponent = () => (
  <Providers>
    <Outlet />
  </Providers>
);
