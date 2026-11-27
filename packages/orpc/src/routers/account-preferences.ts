import { user } from "@quieter/database/schema";
import { ACCOUNT_PREFERENCES_UPDATE_SCOPE } from "@quieter/mail/updates";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { publishMailUpdate } from "../mail-updates";
import { protectedProcedure } from "./base";

const preferencesSelection = {
  timeFormat: user.timeFormat,
  undoSendEnabled: user.undoSendEnabled,
  weekStartsOn: user.weekStartsOn,
};

export const accountPreferencesRouter = {
  get: protectedProcedure
    .route({ method: "GET" })
    .handler(async ({ context, errors }) => {
      const [preferences] = await context.db
        .select(preferencesSelection)
        .from(user)
        .where(eq(user.id, context.userId))
        .limit(1);
      if (preferences === undefined) {
        throw errors.NOT_FOUND();
      }
      return {
        timeFormat: preferences.timeFormat ?? "24h",
        undoSendEnabled: preferences.undoSendEnabled ?? true,
        weekStartsOn: preferences.weekStartsOn ?? 1,
      };
    }),
  update: protectedProcedure
    .input(
      z
        .object({
          timeFormat: z.enum(["12h", "24h"]).optional(),
          undoSendEnabled: z.boolean().optional(),
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
            input.timeFormat !== undefined ||
            input.undoSendEnabled !== undefined ||
            input.weekStartsOn !== undefined,
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
      const notification = publishMailUpdate(
        {
          mailboxId: ACCOUNT_PREFERENCES_UPDATE_SCOPE,
          type: "details.changed",
        },
        { recipientUserIds: [context.userId] }
      );
      if (context.scheduleBackgroundTask) {
        context.scheduleBackgroundTask(notification);
      } else {
        await notification;
      }
      return {
        timeFormat: preferences.timeFormat ?? "24h",
        undoSendEnabled: preferences.undoSendEnabled ?? true,
        weekStartsOn: preferences.weekStartsOn ?? 1,
      };
    }),
};
