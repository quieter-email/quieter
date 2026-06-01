import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/google-scope-repair")({
  loader: () => {
    throw redirect({
      search: {
        tab: "mailboxes",
      },
      to: "/settings",
    });
  },
});
