import { CampaignCreate } from "@quieter/app/features/broadcasts/components/campaign-editor";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/campaigns/new")({
  component: CampaignCreate,
});
