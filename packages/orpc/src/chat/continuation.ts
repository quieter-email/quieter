import { db } from "@quieter/database/client";
import { chatMessage } from "@quieter/database/schema";
import type { ChatMessagePart } from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";

export const replaceChatParts = async (input: {
  chatId: string;
  expectedParts: ChatMessagePart[];
  messageId: string;
  parts: ChatMessagePart[];
  userId: string;
}) => {
  const [updated] = await db
    .update(chatMessage)
    .set({ parts: input.parts })
    .where(
      and(
        eq(chatMessage.id, input.messageId),
        eq(chatMessage.chatId, input.chatId),
        eq(chatMessage.userId, input.userId),
        eq(chatMessage.parts, input.expectedParts)
      )
    )
    .returning({ id: chatMessage.id });
  return updated !== undefined;
};
