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
  list: protectedProcedure.route({ method: "GET" }).handler(async ({ context }) => {
    return await listConnectors(context.userId);
  }),

  startConnection: protectedProcedure
    .input(
      z.object({
        provider: connectorProviderSchema,
        returnTo: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return await startConnectorOAuth({ ...input, userId: context.userId });
    }),

  disconnect: protectedProcedure
    .input(
      z.object({
        provider: connectorProviderSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      return await disconnectConnector({ ...input, userId: context.userId });
    }),

  addGoogleCalendarIcsAttachment: protectedProcedure
    .input(
      z.object({
        attachmentId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
        messageId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      return await addIcsAttachmentToGoogleCalendar({
        ...input,
        signal: context.signal,
        userId: context.userId,
      });
    }),
};
