import { createFileRoute } from "@tanstack/react-router";

import { CampaignDetail } from "#/features/broadcasts/components/campaign-detail";

export const Route = createFileRoute("/_app/campaigns/$campaignId")({
  component: CampaignRoute,
});

function CampaignRoute() {
  const { campaignId } = Route.useParams();
  return <CampaignDetail campaignId={campaignId} key={campaignId} />;
}
