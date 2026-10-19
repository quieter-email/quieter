import { createFileRoute } from "@tanstack/react-router";

import { TemplateEditor } from "#/features/broadcasts/components/templates";

export const Route = createFileRoute("/_app/templates/new")({
  component: TemplateEditor,
});
