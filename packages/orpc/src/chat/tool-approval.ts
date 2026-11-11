import { ORPCError } from "@orpc/server";
import type { ForegroundSnapshot } from "@quieter/ai/chat-tools";
import type { ChatMessagePart } from "@quieter/database/schema";
import { z } from "zod";

import { matchesForegroundLease } from "./continuation";

const canonicalToolInput = (input: unknown) =>
  JSON.stringify(input, (_key, value: unknown) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).toSorted(([left], [right]) =>
            left.localeCompare(right)
          )
        )
      : value
  );

export const assertExactChatToolApproval = (input: {
  approvedPart: ChatMessagePart | undefined;
  exchangeId: string;
  foreground: ForegroundSnapshot;
  proposedPart: ChatMessagePart;
}) => {
  const approved = input.approvedPart;
  const decision = z
    .object({ approved: z.literal(true), id: z.string().min(1) })
    .safeParse(approved?.approval);
  if (
    approved?.state !== "approval-responded" ||
    !decision.success ||
    approved.type !== input.proposedPart.type ||
    approved.toolCallId !== input.proposedPart.toolCallId ||
    input.foreground.exchangeId !== input.exchangeId ||
    !matchesForegroundLease(approved.foreground, input.foreground) ||
    approved.input === undefined ||
    canonicalToolInput(approved.input) !==
      canonicalToolInput(input.proposedPart.input)
  ) {
    throw new ORPCError("CONFLICT", {
      message:
        "Approve the exact action in the current mailbox before continuing.",
    });
  }
};
