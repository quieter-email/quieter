import { createLazyFileRoute } from "@tanstack/react-router";
import { HomePage } from "~/features/home/components/home-page";

export const Route = createLazyFileRoute("/home")({
  component: HomePage,
});
