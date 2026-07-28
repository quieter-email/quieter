import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { LoadingPage } from "~/components/loading-page";

const HomeRouteComponent = lazy(() =>
  import("~/features/home/components/home-route-component").then(
    ({ HomeRouteComponent: Component }) => ({ default: Component }),
  ),
);

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Quieter | The full email stack, finally quiet" },
      {
        content:
          "Gmail, mailboxes on your own domain, shared team workflows, and a send API, together in one calm, keyboard-fast workspace.",
        name: "description",
      },
    ],
  }),
  pendingComponent: LoadingPage,
  component: () => (
    <Suspense fallback={<LoadingPage />}>
      <HomeRouteComponent />
    </Suspense>
  ),
});
