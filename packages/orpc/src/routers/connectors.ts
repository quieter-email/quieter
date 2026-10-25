import { z } from "zod";

import {
  addIcsAttachmentToGoogleCalendar,
  connectorProviderSchema,
  disconnectConnector,
  listConnectors,
  startConnectorOAuth,
} from "../connectors/service";
import { mailboxIdSchema, protectedProcedure } from "./base";

export const connectorsRouter = {
  addGoogleCalendarIcsAttachment: protectedProcedure
    .input(
      z.object({
        attachmentId: z.string().trim().min(1),
        calendarId: z.string().trim().min(1).optional(),
        connectionId: z.string().trim().min(1).optional(),
        mailboxId: mailboxIdSchema,
        messageId: z.string().trim().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await addIcsAttachmentToGoogleCalendar({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  disconnect: protectedProcedure
    .input(
      z.object({
        connectionId: z.string().trim().min(1).optional(),
        provider: connectorProviderSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await disconnectConnector({ ...input, userId: context.userId })
    ),

  list: protectedProcedure
    .route({ method: "GET" })
    .handler(async ({ context }) => await listConnectors(context.userId)),

  startConnection: protectedProcedure
    .input(
      z.object({
        provider: connectorProviderSchema,
        returnTo: z.string().optional(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await startConnectorOAuth({ ...input, userId: context.userId })
    ),
};
