import { TemplateEditor } from "@quieter/app/features/broadcasts/components/templates";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/templates/new")({
  component: TemplateEditor,
});
