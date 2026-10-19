import { createFileRoute } from "@tanstack/react-router";

import { AudienceDetail } from "#/features/broadcasts/components/audience-detail";

export const Route = createFileRoute("/_app/audiences/$audienceId")({
  component: AudienceRoute,
});

function AudienceRoute() {
  const { audienceId } = Route.useParams();
  return <AudienceDetail audienceId={audienceId} key={audienceId} />;
}
