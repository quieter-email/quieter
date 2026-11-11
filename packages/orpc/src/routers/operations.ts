import { waitlistSettingRevision } from "@quieter/database/schema";
import { z } from "zod";

import { getRequestHeaders } from "../context";
import { hasPlatformOperationsAccess } from "../operations-access";
import { getOperationsOverview } from "../operations-metrics";
import { getWaitlistSettings } from "../waitlist";
import { protectedProcedure } from "./base";

const operationsProcedure = protectedProcedure.use(
  async ({ context, next }) => {
    context.resHeaders?.set("cache-control", "private, no-store");
    return await next();
  }
);

const platformAdminProcedure = operationsProcedure.use(
  async ({ context, errors, next }) => {
    if (!(await hasPlatformOperationsAccess(context.userId))) {
      throw errors.FORBIDDEN();
    }
    return await next();
  }
);

export const operationsRouter = {
  access: operationsProcedure
    .route({ method: "GET" })
    .handler(async ({ context }) => ({
      allowed: await hasPlatformOperationsAccess(context.userId),
    })),
  overview: platformAdminProcedure
    .route({ method: "GET" })
    .input(z.object({ days: z.literal([7, 30, 90]) }))
    .handler(
      async ({ context, input }) =>
        await getOperationsOverview({ days: input.days, db: context.db })
    ),
  setWaitlistOpen: platformAdminProcedure
    .route({ method: "POST" })
    .errors({ UNSUPPORTED_MEDIA_TYPE: {} })
    .input(z.object({ waitlistOpen: z.boolean() }))
    .handler(async ({ context, errors, input }) => {
      const [contentType] =
        getRequestHeaders(context).get("content-type")?.split(";", 1) ?? [];
      if (contentType?.trim().toLowerCase() !== "application/json") {
        throw errors.UNSUPPORTED_MEDIA_TYPE();
      }
      await context.db.insert(waitlistSettingRevision).values({
        actorUserId: context.userId,
        waitlistOpen: input.waitlistOpen,
      });
      return await getWaitlistSettings(context.db);
    }),
  settings: platformAdminProcedure
    .route({ method: "GET" })
    .handler(async ({ context }) => await getWaitlistSettings(context.db)),
};
