import { createLazyFileRoute } from "@tanstack/react-router";

import { OperationsDashboard } from "#/features/operations/operations-dashboard";

export const Route = createLazyFileRoute("/_app/operations")({
  component: OperationsDashboard,
});
