import { foregroundSnapshotSchema } from "@quieter/ai/chat-tools";
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

/**
 * Pending tool calls cannot be resumed after a foreground exchange ends. Keep
 * a terminal model-visible result for each one so future transcript conversion
 * remains valid and cannot replay the action.
 */
export const cancelPendingChatParts = (parts: ChatMessagePart[]) => {
  let changed = false;
  const cancelled = parts.map((part) => {
    if (
      (part.state !== "approval-requested" &&
        part.state !== "input-available") ||
      !part.type.startsWith("tool-")
    ) {
      return part;
    }
    changed = true;
    const { approval: _approval, ...withoutApproval } = part;
    return {
      ...withoutApproval,
      errorText: "This workspace action was cancelled before it ran.",
      state: "output-error",
    };
  });
  return changed ? cancelled : parts;
};

export const cancelForegroundExchangeParts = (parts: ChatMessagePart[]) => {
  if (parts.some((part) => part.type === "data-foreground-cancelled")) {
    return parts;
  }
  return [
    ...cancelPendingChatParts(parts),
    { type: "data-foreground-cancelled" },
  ];
};

export const normalizeExpiredChatParts = (
  parts: ChatMessagePart[],
  now = Date.now()
) => {
  const hasExpiredPendingPart = parts.some((part) => {
    if (
      (part.state !== "approval-requested" &&
        part.state !== "input-available") ||
      !part.type.startsWith("tool-")
    ) {
      return false;
    }
    const foreground = foregroundSnapshotSchema.safeParse(part.foreground);
    return !foreground.success || foreground.data.expiresAt <= now;
  });
  return hasExpiredPendingPart ? cancelForegroundExchangeParts(parts) : parts;
};
