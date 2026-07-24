import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { LoadingPage } from "~/components/loading-page";

const HomeRouteComponent = lazy(() =>
  import("~/features/home/components/home-route-component").then(
    ({ HomeRouteComponent: Component }) => ({ default: Component }),
  ),
);

export const Route = createFileRoute("/home")({
  pendingComponent: LoadingPage,
  component: () => (
    <Suspense fallback={<LoadingPage />}>
      <HomeRouteComponent />
    </Suspense>
  ),
});
