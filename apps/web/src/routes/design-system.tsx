import { createFileRoute } from "@tanstack/react-router";

import { DesignSystemShowcase } from "#/features/design-system/components/design-system-showcase";

export const Route = createFileRoute("/design-system")({
  component: DesignSystemShowcase,
  head: () => ({
    meta: [
      { title: "Design system | Quieter" },
      { content: "noindex, nofollow", name: "robots" },
    ],
  }),
});
