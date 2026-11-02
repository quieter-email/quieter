import { AudiencesList } from "@quieter/app/features/broadcasts/components/audiences-list";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/audiences/")({
  component: AudiencesList,
});
