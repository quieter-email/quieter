import { createFileRoute } from "@tanstack/react-router";
import { HomeRouteComponent } from "~/features/home/components/home-route-component";

export const Route = createFileRoute("/home")({
  component: HomeRouteComponent,
});
