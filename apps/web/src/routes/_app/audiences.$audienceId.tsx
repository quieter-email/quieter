import { AudienceDetail } from "@quieter/app/features/broadcasts/components/audience-detail";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/audiences/$audienceId")({
  component: AudienceRoute,
});

function AudienceRoute() {
  const { audienceId } = Route.useParams();
  return <AudienceDetail audienceId={audienceId} key={audienceId} />;
}
