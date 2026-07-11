import { createFileRoute } from "@tanstack/react-router";
import { HomeRouteComponent } from "~/features/home/components/home-route-component";

export const Route = createFileRoute("/home")({
  component: HomeRouteComponent,
  head: () => ({
    links: [
      {
        href: "/favicon.ico",
        rel: "icon",
        sizes: "48x48",
        type: "image/x-icon",
      },
    ],
  }),
});
