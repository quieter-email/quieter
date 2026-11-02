import { CampaignsList } from "@quieter/app/features/broadcasts/components/campaigns-list";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/campaigns/")({
  component: CampaignsList,
});
