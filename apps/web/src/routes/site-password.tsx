import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { SitePasswordRoute } from "~/components/site-password-route";

export const Route = createFileRoute("/site-password")({
  validateSearch: zodValidator(
    z.object({
      returnTo: z
        .string()
        .trim()
        .transform((value) =>
          value && value.startsWith("/") && !value.startsWith("//") ? value : "/",
        )
        .catch("/")
        .default("/"),
      sitePasswordError: z
        .preprocess((value) => value === "1", z.boolean())
        .catch(false)
        .default(false),
    }),
  ),
  component: SitePasswordRoute,
});
