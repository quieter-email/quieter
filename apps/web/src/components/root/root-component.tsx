import { Providers } from "@quieter/app/components/providers";
import { Outlet } from "@tanstack/react-router";

export const RootComponent = () => (
  <Providers>
    <Outlet />
  </Providers>
);
