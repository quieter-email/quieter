import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "#/features/home/components/home-page";

export const Route = createFileRoute("/home")({
  component: HomePage,
  head: () => ({
    links: [
      {
        href: "https://quieter.email/home",
        rel: "canonical",
      },
    ],
    meta: [
      { title: "Quieter | Email, without the noise." },
      {
        content:
          "Your Gmail, your team's mailboxes and the mail your product sends, in one place.",
        name: "description",
      },
      {
        content: "https://quieter.email/home",
        property: "og:url",
      },
    ],
  }),
});
