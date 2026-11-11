import { toCanonicalTranscript } from "@quieter/ai/chat-transcript";
import { db } from "@quieter/database/client";
import { chat, chatMessage } from "@quieter/database/schema";
import type { ChatMessagePart } from "@quieter/database/schema";
import { and, eq, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export const loadChatEditHistory = async (input: {
  chatId: string;
  mailboxId: string;
  messageId: string;
  userId: string;
}) => {
  const editedMessage = alias(chatMessage, "editedMessage");
  const rows = await db
    .select({
      earlierMessage: {
        createdAt: chatMessage.createdAt,
        id: chatMessage.id,
        parts: chatMessage.parts,
        position: chatMessage.position,
        role: chatMessage.role,
      },
      position: editedMessage.position,
    })
    .from(editedMessage)
    .innerJoin(
      chat,
      and(
        eq(chat.id, editedMessage.chatId),
        eq(chat.userId, editedMessage.userId)
      )
    )
    .leftJoin(
      chatMessage,
      and(
        eq(chatMessage.chatId, editedMessage.chatId),
        eq(chatMessage.userId, editedMessage.userId),
        lt(chatMessage.position, editedMessage.position)
      )
    )
    .where(
      and(
        eq(editedMessage.chatId, input.chatId),
        eq(editedMessage.id, input.messageId),
        eq(editedMessage.role, "user"),
        eq(chat.mailboxId, input.mailboxId),
        eq(chat.userId, input.userId)
      )
    )
    .orderBy(chatMessage.position);
  const [first] = rows;
  if (first === undefined) {
    return null;
  }
  const messages = rows.flatMap(({ earlierMessage }) => {
    if (earlierMessage === null) {
      return [];
    }
    return toCanonicalTranscript([earlierMessage]).map((message) => ({
      createdAt: earlierMessage.createdAt,
      id: crypto.randomUUID(),
      parts: message.parts.map(
        ({
          approval: _approval,
          foreground: _foreground,
          ...part
        }: ChatMessagePart) => part
      ),
      position: earlierMessage.position,
      role: message.role,
    }));
  });
  return { messages, position: first.position };
};
