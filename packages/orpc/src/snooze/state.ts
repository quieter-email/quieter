import { db } from "@quieter/database/client";
import {
  mailbox,
  mailPlacementOperation,
  mailSnooze,
} from "@quieter/database/schema";
import type { MailSnoozeState } from "@quieter/mail/snooze";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { publishMailUpdate } from "../mail-updates";
import { assertAccessibleMailbox } from "../mailbox/service";

export const MAIL_SNOOZE_LIVE_STATUSES = [
  "preparing",
  "active",
  "returning",
  "suspended",
  "failed",
  "uncertain",
] as const;

export const serializeMailSnoozeState = (
  row: typeof mailSnooze.$inferSelect
): MailSnoozeState => ({
  code: row.code ?? undefined,
  id: row.id,
  mailboxId: row.mailboxId,
  message: row.message ?? undefined,
  returnAt: row.returnAt.toISOString(),
  status: row.status,
  threadId: row.threadId,
  timeZone: row.timeZone,
  version: row.version,
});

export const getMailSnoozeStates = async (input: {
  userId: string;
  mailboxId: string;
  threadIds: string[];
}) => {
  await assertAccessibleMailbox(input);
  if (input.threadIds.length === 0) {
    return new Map<string, MailSnoozeState>();
  }
  const rows = await db
    .select()
    .from(mailSnooze)
    .where(
      and(
        eq(mailSnooze.mailboxId, input.mailboxId),
        inArray(mailSnooze.threadId, [...new Set(input.threadIds)])
      )
    );
  return new Map(
    rows.map((row) => [row.threadId, serializeMailSnoozeState(row)])
  );
};

export const reconcileMailSnoozeSource = async (input: {
  mailboxId: string;
  threadId: string;
  expectedVersion: number;
  inboxIncomingMessageIds: string[];
}) => {
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .for("update");
    const [current] = await tx
      .select()
      .from(mailSnooze)
      .where(
        and(
          eq(mailSnooze.mailboxId, input.mailboxId),
          eq(mailSnooze.threadId, input.threadId)
        )
      )
      .for("update");
    if (
      current === undefined ||
      current.version !== input.expectedVersion ||
      current.status !== "active" ||
      !input.inboxIncomingMessageIds.some(
        (id) => !current.knownIncomingMessageIds.includes(id)
      ) ||
      current.hideOperationId === null
    ) {
      return { changed: false, row: current };
    }
    const [latest] = await tx
      .select()
      .from(mailPlacementOperation)
      .where(
        and(
          eq(mailPlacementOperation.mailboxId, input.mailboxId),
          eq(mailPlacementOperation.threadId, input.threadId)
        )
      )
      .orderBy(desc(mailPlacementOperation.sequence))
      .limit(1);
    if (latest?.id !== current.hideOperationId || latest.status !== "applied") {
      return { changed: false, row: current };
    }
    const [updated] = await tx
      .update(mailSnooze)
      .set({
        code: "source_reopened",
        leaseToken: null,
        leaseUntil: null,
        message: null,
        nextWakeAt: null,
        status: "superseded",
        updatedAt: new Date(),
        version: current.version + 1,
      })
      .where(
        and(
          eq(mailSnooze.id, current.id),
          eq(mailSnooze.version, current.version)
        )
      )
      .returning();
    await tx
      .update(mailbox)
      .set({
        contentRevision: sql`${mailbox.contentRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(mailbox.id, input.mailboxId));
    return { changed: true, row: updated ?? current };
  });
  if (result.changed) {
    await publishMailUpdate({
      mailboxId: input.mailboxId,
      type: "mailbox.changed",
    });
  }
  return result.row === undefined
    ? undefined
    : serializeMailSnoozeState(result.row);
};
