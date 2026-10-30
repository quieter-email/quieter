import { LoadingPage } from "@quieter/app/components/loading-page";
import { getSafeAuthReturnTo } from "@quieter/app/lib/return-to";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

export const Route = createFileRoute("/_app/site-password")({
  pendingComponent: LoadingPage,
  validateSearch: zodValidator(
    z.object({
      returnTo: z
        .string()
        .transform((value) => getSafeAuthReturnTo(value) ?? "/")
        .catch("/")
        .default("/"),
      sitePasswordError: z
        .preprocess((value) => {
          if (typeof value === "string") {
            return ["1", "true", "yes", "on"].includes(
              value.trim().toLowerCase()
            );
          }

          if (typeof value === "boolean" || typeof value === "number") {
            return Boolean(value);
          }

          return false;
        }, z.boolean())
        .catch(false)
        .default(false),
    })
  ),
});
