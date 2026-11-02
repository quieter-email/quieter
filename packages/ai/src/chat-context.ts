import { z } from "zod";

export const MAX_CHAT_CONTEXT_MESSAGES = 20;

const messageIdentifierSchema = z.string().trim().min(1).max(256);

export const chatMailContextSchema = z
  .object({
    messageId: messageIdentifierSchema.optional(),
    messageIds: z
      .array(messageIdentifierSchema)
      .max(MAX_CHAT_CONTEXT_MESSAGES)
      .transform((messageIds) => [...new Set(messageIds)])
      .optional(),
    query: z.string().trim().min(1).max(500).optional(),
    threadId: messageIdentifierSchema.optional(),
  })
  .strict();

export type ChatMailContext = z.infer<typeof chatMailContextSchema>;
