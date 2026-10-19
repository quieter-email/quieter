import { createFileRoute } from "@tanstack/react-router";

import { TemplatesList } from "#/features/broadcasts/components/templates";

export const Route = createFileRoute("/_app/templates/")({
  component: TemplatesList,
});
