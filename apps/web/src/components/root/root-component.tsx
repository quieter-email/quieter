import { Outlet } from "@tanstack/react-router";
import { Providers } from "~/components/providers";
import { RootDocument } from "./root-document";

export const RootComponent = () => (
  <RootDocument>
    <Providers>
      <Outlet />
    </Providers>
  </RootDocument>
);
