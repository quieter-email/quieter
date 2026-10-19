import { createFileRoute } from "@tanstack/react-router";

import { TemplateDetail } from "#/features/broadcasts/components/templates";

export const Route = createFileRoute("/_app/templates/$templateId")({
  component: TemplateRoute,
});

function TemplateRoute() {
  const { templateId } = Route.useParams();
  return <TemplateDetail key={templateId} templateId={templateId} />;
}
