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
        .preprocess((value) => {
          if (typeof value === "string") {
            return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
          }

          if (typeof value === "boolean" || typeof value === "number") {
            return Boolean(value);
          }

          return false;
        }, z.boolean())
        .catch(false)
        .default(false),
    }),
  ),
  component: SitePasswordRoute,
});
