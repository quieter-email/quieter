import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  mailboxChangeHead,
  mailboxChangeJournal,
} from "@quieter/database/schema";
import { mailboxChangeSchema } from "@quieter/mail/updates";
import type { MailboxChange, MailUpdate } from "@quieter/mail/updates";
import { reportError } from "@quieter/observability";
import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { enqueueMailDispatch } from "./mail-dispatch";
import { listMailUpdateRecipients, publishMailUpdate } from "./mail-updates";

const JOURNAL_RETENTION = 256n;
const REPLAY_LIMIT = 64n;
const MAX_CHANGES = 100;
const changesSchema = z.array(mailboxChangeSchema).min(1).max(MAX_CHANGES);

export const appendMailboxChange = async (
  tx: DatabaseTransaction,
  input: {
    changes: MailboxChange[];
    contentRevision?: number;
    mailboxId: string;
    recipientUserIds?: string[];
  }
) => {
  const { mailboxId } = input;
  const changes = changesSchema.parse(
    input.changes.length > MAX_CHANGES
      ? [{ kind: "mailbox.reconcile" }]
      : input.changes
  );
  const [head] = await tx
    .insert(mailboxChangeHead)
    .values({ mailboxId, version: 1n })
    .onConflictDoUpdate({
      set: { version: sql`${mailboxChangeHead.version} + 1` },
      target: mailboxChangeHead.mailboxId,
    })
    .returning({ version: mailboxChangeHead.version });
  const { recipientUserIds: requestedRecipients } = input;
  const allowed =
    requestedRecipients === undefined
      ? undefined
      : await listMailUpdateRecipients(mailboxId, tx);
  const recipientUserIds = allowed?.filter(
    (userId) => requestedRecipients?.includes(userId) === true
  );
  await tx.insert(mailboxChangeJournal).values({
    changes,
    contentRevision: input.contentRevision,
    mailboxId,
    recipientUserIds,
    version: head.version,
  });
  await tx
    .delete(mailboxChangeJournal)
    .where(
      and(
        eq(mailboxChangeJournal.mailboxId, mailboxId),
        lte(mailboxChangeJournal.version, head.version - JOURNAL_RETENTION)
      )
    );
  const threadIds = [
    ...new Set(
      changes.flatMap((change) =>
        "threadId" in change && change.threadId ? [change.threadId] : []
      )
    ),
  ];
  const update: MailUpdate = {
    change: {
      kinds: [...new Set(changes.map(({ kind }) => kind))],
      version: String(head.version),
    },
    eventId: crypto.randomUUID(),
    mailboxId,
    threadIds: changes.every(
      (change) => "threadId" in change && change.threadId !== undefined
    )
      ? threadIds
      : undefined,
    type: "mailbox.changed",
  };
  const queued = await enqueueMailDispatch(tx, {
    kind: "live",
    recipientUserIds,
    update,
  });
  return { queued, recipientUserIds, update };
};

export const publishMailboxChange = async (
  committed: Awaited<ReturnType<typeof appendMailboxChange>> | null | undefined
) => {
  if (committed === null || committed === undefined || committed.queued) {
    return;
  }
  const {
    update: { eventId, ...update },
    recipientUserIds,
  } = committed;
  try {
    const allowed = await listMailUpdateRecipients(update.mailboxId);
    await publishMailUpdate(update, {
      eventId,
      recipientUserIds: allowed.filter(
        (userId) => recipientUserIds?.includes(userId) ?? true
      ),
    });
  } catch (error) {
    reportError(error, { boundary: "mailbox-change-delivery" });
  }
};

// The caller supplies the authorized mailbox snapshot. A concurrent prune can
// invalidate this range, so only a complete prefix is eligible for replay.
export const readMailboxChanges = async (input: {
  afterVersion: string;
  headVersion: bigint;
  mailboxId: string;
  userId: string;
}) => {
  const after = BigInt(input.afterVersion);
  const count = input.headVersion - after;
  if (count < 0n || count > REPLAY_LIMIT) {
    return null;
  }
  if (count === 0n) {
    return { changes: [], contentRevisions: [] };
  }
  const rows = await db
    .select()
    .from(mailboxChangeJournal)
    .where(
      and(
        eq(mailboxChangeJournal.mailboxId, input.mailboxId),
        gt(mailboxChangeJournal.version, after),
        lte(mailboxChangeJournal.version, input.headVersion)
      )
    )
    .orderBy(asc(mailboxChangeJournal.version))
    .limit(Number(count));
  if (rows.length !== Number(count)) {
    return null;
  }
  const changes: MailboxChange[] = [];
  const contentRevisions: number[] = [];
  for (const row of rows) {
    if (
      row.recipientUserIds !== null &&
      !row.recipientUserIds.includes(input.userId)
    ) {
      continue;
    }
    const parsed = changesSchema.safeParse(row.changes);
    if (
      !parsed.success ||
      parsed.data.some(({ kind }) => kind === "mailbox.reconcile")
    ) {
      return null;
    }
    changes.push(...parsed.data);
    if (changes.length > MAX_CHANGES) {
      return null;
    }
    if (row.contentRevision !== null) {
      contentRevisions.push(row.contentRevision);
    }
  }
  return { changes, contentRevisions };
};
