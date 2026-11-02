import { CampaignDetail } from "@quieter/app/features/broadcasts/components/campaign-detail";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/campaigns/$campaignId/")({
  component: CampaignRoute,
});

function CampaignRoute() {
  const { campaignId } = Route.useParams();
  return <CampaignDetail campaignId={campaignId} key={campaignId} />;
}
