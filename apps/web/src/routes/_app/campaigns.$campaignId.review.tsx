import { CampaignPage } from "@quieter/app/features/broadcasts/components/campaign-editor";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/campaigns/$campaignId/review")({
  component: CampaignReviewRoute,
});

function CampaignReviewRoute() {
  const { campaignId } = Route.useParams();
  return <CampaignPage campaignId={campaignId} step="review" />;
}
