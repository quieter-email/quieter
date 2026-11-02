import { TemplateDetail } from "@quieter/app/features/broadcasts/components/templates";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/templates/$templateId")({
  component: TemplateRoute,
});

function TemplateRoute() {
  const { templateId } = Route.useParams();
  return <TemplateDetail key={templateId} templateId={templateId} />;
}
