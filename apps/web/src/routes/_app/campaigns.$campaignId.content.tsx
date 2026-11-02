import { CampaignPage } from "@quieter/app/features/broadcasts/components/campaign-editor";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/campaigns/$campaignId/content")({
  component: CampaignContentRoute,
});

function CampaignContentRoute() {
  const { campaignId } = Route.useParams();
  return <CampaignPage campaignId={campaignId} step="content" />;
}
