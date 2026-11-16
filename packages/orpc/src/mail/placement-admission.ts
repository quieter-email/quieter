import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { managedMailMessage } from "@quieter/database/schema";
import {
  getGmailMessageThreadAssociations,
  getGmailThreadMessageCount,
  getThreadWithDetails,
} from "@quieter/gmail";
import { and, asc, eq, inArray } from "drizzle-orm";

import { consumeRateLimit } from "../abuse-protection";
import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { writeGmailCapturedMessage } from "../mail-capture";
import type { PlacementMessage } from "./placement-model";

export const loadMailPlacementAssociations = async (input: {
  database: Pick<typeof db, "select">;
  context: MailRequestContext;
  mailboxId: string;
  provider: string;
  messageIds: string[];
  accessToken?: string;
}) => {
  if (input.provider === "managed") {
    return await input.database
      .select({
        id: managedMailMessage.id,
        threadId: managedMailMessage.threadId,
      })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          inArray(managedMailMessage.id, input.messageIds)
        )
      );
  }
  if (input.accessToken === undefined) {
    throw new Error(
      "Placement admission requires an authorized mailbox token."
    );
  }
  const deadline = AbortSignal.timeout(15_000);
  const signal = input.context.signal
    ? AbortSignal.any([input.context.signal, deadline])
    : deadline;
  const associations = await getGmailMessageThreadAssociations(
    input.accessToken,
    input.messageIds,
    signal
  );
  signal.throwIfAborted();
  return associations;
};

export const loadMailPlacementSnapshot = async (input: {
  context: MailRequestContext;
  mailboxId: string;
  provider: string;
  threadId: string;
  anchorCount: number;
  budget: { remaining: number };
}): Promise<{ messages: PlacementMessage[]; incomingMessageIds: string[] }> => {
  input.context.signal?.throwIfAborted();
  if (input.budget.remaining === 0) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "This action includes too much conversation history. Choose fewer conversations and try again.",
    });
  }
  let source:
    | {
        kind: "managed";
        messages: PlacementMessage[];
        incomingMessageIds: string[];
      }
    | { kind: "gmail"; messageCount: number };
  if (input.provider === "managed") {
    const records = await db
      .select({
        createdAt: managedMailMessage.createdAt,
        direction: managedMailMessage.direction,
        id: managedMailMessage.id,
        mailboxState: managedMailMessage.mailboxState,
        threadId: managedMailMessage.threadId,
      })
      .from(managedMailMessage)
      .where(
        and(
          eq(managedMailMessage.mailboxId, input.mailboxId),
          eq(managedMailMessage.threadId, input.threadId)
        )
      )
      .orderBy(asc(managedMailMessage.createdAt), asc(managedMailMessage.id))
      .limit(input.budget.remaining + 1);
    source = {
      incomingMessageIds: records
        .filter((record) => record.direction === "inbound")
        .map((record) => record.id),
      kind: "managed",
      messages: records.map((record) => {
        let placement: PlacementMessage["placement"] = "protected";
        if (
          record.direction === "inbound" &&
          record.mailboxState === "active"
        ) {
          placement = "inbox";
        } else if (
          record.direction === "inbound" &&
          record.mailboxState === "done"
        ) {
          placement = "done";
        }
        return {
          id: record.id,
          placement,
          receivedAt: record.createdAt.getTime(),
          threadId: record.threadId,
        };
      }),
    };
  } else {
    source = {
      kind: "gmail",
      messageCount: await callGmail(
        input.context,
        input.mailboxId,
        async (token, signal) =>
          await getGmailThreadMessageCount(token, input.threadId, signal)
      ),
    };
  }
  const count =
    source.kind === "managed" ? source.messages.length : source.messageCount;
  const additionalCost = Math.max(0, count - input.anchorCount);
  if (additionalCost > 0) {
    const admission = await consumeRateLimit({
      cost: additionalCost,
      key: `mail-placement:${input.context.userId}`,
      limit: 10_000,
      windowMs: 60 * 60_000,
    });
    if (!admission.allowed) {
      input.budget.remaining = 0;
      const retryAfter = Math.max(
        1,
        Math.ceil((admission.resetAt.getTime() - Date.now()) / 1000)
      );
      input.context.resHeaders?.set("retry-after", String(retryAfter));
      throw new ORPCError("RATE_LIMITED", {
        data: { provider: "server", retryAfter },
        message: "Too many conversations were changed. Try again later.",
        status: 429,
      });
    }
  }
  if (count > input.budget.remaining) {
    input.budget.remaining = 0;
    throw new ORPCError("BAD_REQUEST", {
      message:
        "This action includes too much conversation history. Choose fewer conversations and try again.",
    });
  }
  input.budget.remaining -= count;
  if (source.kind === "managed") {
    return {
      incomingMessageIds: source.incomingMessageIds,
      messages: source.messages,
    };
  }
  const thread = await callGmail(
    input.context,
    input.mailboxId,
    async (token, signal) =>
      await getThreadWithDetails(
        token,
        input.threadId,
        signal,
        async (snapshot) => {
          signal?.throwIfAborted();
          await writeGmailCapturedMessage({
            mailboxId: input.mailboxId,
            snapshot,
            source: "on_demand",
          });
        },
        count
      )
  );
  return {
    incomingMessageIds: thread.messages
      .filter(
        (message) =>
          message.labelIds?.some((label) =>
            ["SENT", "DRAFT"].includes(label)
          ) !== true
      )
      .map((message) => message.id),
    messages: thread.messages.map((message) => {
      let placement: PlacementMessage["placement"] = "done";
      if (
        message.labelIds?.some((label) =>
          ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label)
        ) === true
      ) {
        placement = "protected";
      } else if (message.labelIds?.includes("INBOX") === true) {
        placement = "inbox";
      }
      return {
        id: message.id,
        placement,
        receivedAt: Number(message.internalDate ?? 0),
        threadId: message.threadId,
      };
    }),
  };
};
