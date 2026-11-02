import { DesignSystemShowcase } from "@quieter/app/features/design-system/components/design-system-showcase";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/design-system")({
  component: DesignSystemShowcase,
  head: () => ({
    meta: [
      { title: "Design system | quieter" },
      { content: "noindex, nofollow", name: "robots" },
    ],
  }),
});
