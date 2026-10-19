import { createFileRoute } from "@tanstack/react-router";

import { CampaignCreate } from "#/features/broadcasts/components/campaign-editor";

export const Route = createFileRoute("/_app/campaigns/new")({
  component: CampaignCreate,
});
