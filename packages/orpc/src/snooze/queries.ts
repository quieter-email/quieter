import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailPlacementOperation, mailSnooze } from "@quieter/database/schema";
import type { MailCategory } from "@quieter/mail/data-plane";
import type { MessageListItem } from "@quieter/mail/messages";
import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { assertAccessibleMailbox } from "../mailbox/service";
import {
  getMailSnoozeStateEntries,
  MAIL_SNOOZE_LIVE_STATUSES,
  reconcileMailSnoozeSource,
  serializeMailSnoozeState,
} from "./state";

const pageCursorSchema = z.object({
  id: z.string().min(1).max(255),
  kind: z.literal("mail-snooze"),
  mailboxId: z.string().min(1).max(255),
  returnAt: z.iso.datetime({ offset: true }),
});

export const mailSnoozeVisibilityCondition = (input: {
  mailboxId: string | SQLWrapper;
  threadId: string | SQLWrapper;
  kind: "later" | "owns-placement";
}) => {
  const current = alias(mailSnooze, "visible_snooze");
  const owned = alias(mailPlacementOperation, "snooze_owned_placement");
  const newer = alias(mailPlacementOperation, "snooze_newer_placement");
  const ownsLatest = exists(
    db
      .select({ id: owned.id })
      .from(owned)
      .where(
        and(
          or(
            eq(owned.id, current.hideOperationId),
            eq(owned.id, current.returnOperationId)
          ),
          eq(owned.mailboxId, current.mailboxId),
          eq(owned.threadId, current.threadId),
          ne(owned.status, "superseded"),
          notExists(
            db
              .select({ id: newer.id })
              .from(newer)
              .where(
                and(
                  eq(newer.mailboxId, current.mailboxId),
                  eq(newer.threadId, current.threadId),
                  gt(newer.sequence, owned.sequence)
                )
              )
          )
        )
      )
  );
  return exists(
    db
      .select({ id: current.id })
      .from(current)
      .where(
        and(
          eq(current.mailboxId, input.mailboxId),
          eq(current.threadId, input.threadId),
          inArray(current.status, MAIL_SNOOZE_LIVE_STATUSES),
          input.kind === "owns-placement"
            ? and(sql`${current.hiddenMessageIds} <> '[]'::jsonb`, ownsLatest)
            : or(
                and(
                  isNull(current.hideOperationId),
                  isNull(current.returnOperationId)
                ),
                ownsLatest
              )
        )
      )
  );
};

export const listMailSnoozePage = async (input: {
  userId: string;
  mailboxId: string;
  maxResults?: number;
  pageToken?: string;
}) => {
  await assertAccessibleMailbox(input);
  let cursor: z.infer<typeof pageCursorSchema> | undefined;
  if (input.pageToken) {
    try {
      const value: unknown = JSON.parse(
        Buffer.from(input.pageToken, "base64url").toString("utf-8")
      );
      cursor = pageCursorSchema.parse(value);
      if (cursor.mailboxId !== input.mailboxId) {
        throw new Error("Cursor belongs to another inbox.");
      }
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "The message page token is invalid.",
      });
    }
  }
  const limit = Math.min(input.maxResults ?? 20, 100);
  const rows = await db
    .select()
    .from(mailSnooze)
    .where(
      and(
        eq(mailSnooze.mailboxId, input.mailboxId),
        mailSnoozeVisibilityCondition({
          kind: "later",
          mailboxId: mailSnooze.mailboxId,
          threadId: mailSnooze.threadId,
        }),
        cursor
          ? or(
              gt(mailSnooze.returnAt, new Date(cursor.returnAt)),
              and(
                eq(mailSnooze.returnAt, new Date(cursor.returnAt)),
                gt(mailSnooze.id, cursor.id)
              )
            )
          : undefined
      )
    )
    .orderBy(asc(mailSnooze.returnAt), asc(mailSnooze.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    nextPageToken:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              id: last.id,
              kind: "mail-snooze",
              mailboxId: input.mailboxId,
              returnAt: last.returnAt.toISOString(),
            })
          ).toString("base64url")
        : undefined,
    snoozes: page.map(serializeMailSnoozeState),
  };
};

export const countVisibleMailSnoozes = async (input: {
  userId: string;
  mailboxId: string;
}): Promise<number> => {
  await assertAccessibleMailbox(input);
  const [row] = await db
    .select({ total: count() })
    .from(mailSnooze)
    .where(
      and(
        eq(mailSnooze.mailboxId, input.mailboxId),
        mailSnoozeVisibilityCondition({
          kind: "later",
          mailboxId: mailSnooze.mailboxId,
          threadId: mailSnooze.threadId,
        })
      )
    );
  return row?.total ?? 0;
};

export const attachMailSnoozeStates = async (input: {
  userId: string;
  mailboxId: string;
  messages: MessageListItem[];
}): Promise<MessageListItem[]> => {
  const entries = await getMailSnoozeStateEntries({
    mailboxId: input.mailboxId,
    threadIds: [...new Set(input.messages.map((message) => message.threadId))],
    userId: input.userId,
  });
  const states = new Map(
    [...entries.entries()].map(([threadId, entry]) => [threadId, entry.state])
  );
  const inboxIncomingMessageIdsByThreadId = new Map<string, Set<string>>();
  for (const message of input.messages) {
    const messageIds =
      inboxIncomingMessageIdsByThreadId.get(message.threadId) ??
      new Set<string>();
    for (const id of message.threadInboxIncomingMessageIds ?? []) {
      messageIds.add(id);
    }
    if (
      message.labelIds?.includes("INBOX") === true &&
      !message.labelIds.some((label) =>
        ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label)
      )
    ) {
      messageIds.add(message.id);
    }
    inboxIncomingMessageIdsByThreadId.set(message.threadId, messageIds);
  }
  for (const [threadId, entry] of entries) {
    const inboxIncomingMessageIds =
      inboxIncomingMessageIdsByThreadId.get(threadId);
    if (
      entry.state.status === "active" &&
      inboxIncomingMessageIds !== undefined &&
      [...inboxIncomingMessageIds].some(
        (id) => !entry.knownIncomingMessageIds.includes(id)
      )
    ) {
      const current = await reconcileMailSnoozeSource({
        expectedVersion: entry.state.version,
        inboxIncomingMessageIds: [...inboxIncomingMessageIds],
        mailboxId: input.mailboxId,
        threadId,
      });
      if (current) {
        states.set(threadId, current);
      } else {
        states.delete(threadId);
      }
    }
  }
  return input.messages.map((message) => ({
    ...message,
    snooze: states.get(message.threadId),
  }));
};

export const filterMailSnoozeVisibility = async (input: {
  userId: string;
  mailboxId: string;
  category?: MailCategory;
  threadIds: string[];
  messages?: MessageListItem[];
}): Promise<Set<string>> => {
  await assertAccessibleMailbox(input);
  const threadIds = [...new Set(input.threadIds)];
  if (
    threadIds.length === 0 ||
    (input.category !== "later" && input.category !== "done")
  ) {
    return new Set(threadIds);
  }
  if (input.messages) {
    await attachMailSnoozeStates({
      mailboxId: input.mailboxId,
      messages: input.messages,
      userId: input.userId,
    });
  }
  const rows = await db
    .select({ threadId: mailSnooze.threadId })
    .from(mailSnooze)
    .where(
      and(
        eq(mailSnooze.mailboxId, input.mailboxId),
        inArray(mailSnooze.threadId, threadIds),
        mailSnoozeVisibilityCondition({
          kind: input.category === "later" ? "later" : "owns-placement",
          mailboxId: mailSnooze.mailboxId,
          threadId: mailSnooze.threadId,
        })
      )
    );
  const scheduled = new Set(rows.map((row) => row.threadId));
  return input.category === "later"
    ? scheduled
    : new Set(threadIds.filter((threadId) => !scheduled.has(threadId)));
};
