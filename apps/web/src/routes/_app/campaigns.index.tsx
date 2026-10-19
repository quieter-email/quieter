import { createFileRoute } from "@tanstack/react-router";

import { CampaignsList } from "#/features/broadcasts/components/campaigns-list";

export const Route = createFileRoute("/_app/campaigns/")({
  component: CampaignsList,
});
