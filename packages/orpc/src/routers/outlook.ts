import { z } from "zod";

import { getRequestHeaders } from "../context";
import {
  disconnectOutlookMailbox,
  getOutlookConnectionStatus,
  startOutlookOAuth,
} from "../outlook/service";
import { protectedProcedure } from "./base";

export const outlookRouter = {
  disconnect: protectedProcedure
    .input(z.object({ mailboxId: z.string().trim().min(1) }))
    .handler(
      async ({ context, input }) =>
        await disconnectOutlookMailbox({ ...input, userId: context.userId })
    ),
  startConnection: protectedProcedure
    .input(
      z.object({
        mailboxId: z.string().trim().min(1).optional(),
        organizationId: z.string().trim().min(1),
        returnTo: z.string().optional(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await startOutlookOAuth({
          ...input,
          headers: getRequestHeaders(context),
          userId: context.userId,
        })
    ),
  status: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: z.string().trim().min(1).optional() }))
    .handler(
      async ({ context, input }) =>
        await getOutlookConnectionStatus({ ...input, userId: context.userId })
    ),
};
