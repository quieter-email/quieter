import { foregroundSnapshotSchema } from "@quieter/ai/chat-tools";
import type { ForegroundSnapshot } from "@quieter/ai/chat-tools";
import { db } from "@quieter/database/client";
import { chatMessage } from "@quieter/database/schema";
import type { ChatMessagePart } from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";

import { hashRequest } from "../request-hash";

export const FOREGROUND_LEASE_MS = 5 * 60_000;

export const matchesForegroundLease = (
  stored: unknown,
  foreground: ForegroundSnapshot,
  now = Date.now()
) => {
  const lease = foregroundSnapshotSchema.safeParse(stored);
  return (
    lease.success &&
    lease.data.expiresAt > now &&
    hashRequest({ ...lease.data, expiresAt: foreground.expiresAt }) ===
      hashRequest(foreground)
  );
};

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

export const interruptedChatParts = (input: {
  errorText: string;
  persistedParts: ChatMessagePart[];
  retryable: boolean;
  streamedParts: ChatMessagePart[];
}): ChatMessagePart[] => {
  const persistedTools = new Map(
    input.persistedParts
      .filter((part) => typeof part.toolCallId === "string")
      .map((part) => [part.toolCallId, part])
  );
  const durableParts = (
    input.streamedParts.length === 0
      ? input.persistedParts
      : input.streamedParts
  )
    .filter(
      (part) =>
        part.type !== "data-foreground" &&
        part.type !== "data-foreground-failed" &&
        part.type !== "data-chat-interruption"
    )
    .map((part) => {
      const persisted = persistedTools.get(part.toolCallId);
      persistedTools.delete(part.toolCallId);
      if (
        (part.type === "text" || part.type === "reasoning") &&
        part.state === "streaming"
      ) {
        return { ...part, state: "done" };
      }
      return persisted === undefined ? part : { ...part, ...persisted };
    });
  durableParts.push(...persistedTools.values());
  if (
    input.persistedParts.some(
      (part) => part.type === "data-foreground-cancelled"
    ) &&
    !durableParts.some((part) => part.type === "data-foreground-cancelled")
  ) {
    durableParts.push({ type: "data-foreground-cancelled" });
  }
  const hasResult = durableParts.some(
    (part) =>
      part.type === "data-foreground-cancelled" ||
      part.type.startsWith("tool-") ||
      (part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim() !== "")
  );
  return [
    ...(input.retryable && !hasResult
      ? [{ type: "data-foreground-failed" }]
      : cancelPendingChatParts(durableParts)),
    { data: input.errorText, type: "data-chat-interruption" },
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
    const foreground = foregroundSnapshotSchema
      .strip()
      .safeParse(part.foreground);
    return !foreground.success || foreground.data.expiresAt <= now;
  });
  return hasExpiredPendingPart ? cancelForegroundExchangeParts(parts) : parts;
};
