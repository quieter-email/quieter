import { createFileRoute } from "@tanstack/react-router";

import { AudiencesList } from "#/features/broadcasts/components/audiences-list";

export const Route = createFileRoute("/_app/audiences/")({
  component: AudiencesList,
});
