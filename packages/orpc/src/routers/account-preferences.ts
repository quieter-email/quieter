import { regionalTimeFormat } from "@quieter/auth/regional-time";
import { user } from "@quieter/database/schema";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getRequestHeaders } from "../context";
import { protectedProcedure } from "./base";

const preferencesSelection = {
  timeFormat: user.timeFormat,
  weekStartsOn: user.weekStartsOn,
};

export const accountPreferencesRouter = {
  get: protectedProcedure
    .route({ method: "GET" })
    .handler(async ({ context, errors }) => {
      let [preferences] = await context.db
        .select(preferencesSelection)
        .from(user)
        .where(eq(user.id, context.userId))
        .limit(1);
      if (preferences === undefined) {
        throw errors.NOT_FOUND();
      }
      if (preferences.timeFormat === null) {
        await context.db
          .update(user)
          .set({
            timeFormat: regionalTimeFormat(
              getRequestHeaders(context).get("accept-language")
            ),
          })
          .where(and(eq(user.id, context.userId), isNull(user.timeFormat)));
        [preferences] = await context.db
          .select(preferencesSelection)
          .from(user)
          .where(eq(user.id, context.userId))
          .limit(1);
        if (preferences === undefined) {
          throw errors.NOT_FOUND();
        }
      }
      return {
        timeFormat: preferences.timeFormat ?? "24h",
        weekStartsOn: preferences.weekStartsOn ?? 1,
      };
    }),
  update: protectedProcedure
    .input(
      z
        .object({
          timeFormat: z.enum(["12h", "24h"]).optional(),
          weekStartsOn: z
            .union([
              z.literal(0),
              z.literal(1),
              z.literal(2),
              z.literal(3),
              z.literal(4),
              z.literal(5),
              z.literal(6),
            ])
            .optional(),
        })
        .refine(
          (input) =>
            input.timeFormat !== undefined || input.weekStartsOn !== undefined,
          "Choose a preference to update."
        )
    )
    .handler(async ({ context, input, errors }) => {
      const [preferences] = await context.db
        .update(user)
        .set(input)
        .where(eq(user.id, context.userId))
        .returning(preferencesSelection);
      if (preferences === undefined) {
        throw errors.NOT_FOUND();
      }
      return {
        timeFormat:
          preferences.timeFormat ??
          regionalTimeFormat(getRequestHeaders(context).get("accept-language")),
        weekStartsOn: preferences.weekStartsOn ?? 1,
      };
    }),
};
