import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

export const Route = createFileRoute("/google-scope-repair")({
  validateSearch: zodValidator(z.record(z.string(), z.unknown())),
  loader: (ctx) => {
    const { search } = ctx as unknown as { search: Record<string, unknown> };
    throw redirect({
      search: {
        tab: "mailboxes",
        ...search,
      },
      to: "/settings",
    });
  },
});
