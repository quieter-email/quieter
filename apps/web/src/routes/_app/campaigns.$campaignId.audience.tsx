import { createFileRoute } from "@tanstack/react-router";

import { CampaignPage } from "#/features/broadcasts/components/campaign-editor";

export const Route = createFileRoute("/_app/campaigns/$campaignId/audience")({
  component: CampaignAudienceRoute,
});

function CampaignAudienceRoute() {
  const { campaignId } = Route.useParams();
  return <CampaignPage campaignId={campaignId} step="audience" />;
}
