import type { DatabaseTransaction } from "@quieter/database/client";
import { mailbox } from "@quieter/database/schema";
import type { MailboxChange } from "@quieter/mail/updates";
import { eq, sql } from "drizzle-orm";

import { appendMailboxChange } from "../mailbox-changes";

export const appendManagedMailboxContentChange = async (
  tx: DatabaseTransaction,
  input: { changes: MailboxChange[]; mailboxId: string; updatedAt?: Date }
) => {
  const [{ contentRevision }] = await tx
    .update(mailbox)
    .set({
      contentRevision: sql`${mailbox.contentRevision} + 1`,
      updatedAt: input.updatedAt ?? new Date(),
    })
    .where(eq(mailbox.id, input.mailboxId))
    .returning({ contentRevision: mailbox.contentRevision });
  const committed = await appendMailboxChange(tx, {
    changes: input.changes,
    contentRevision,
    mailboxId: input.mailboxId,
  });
  return { ...committed, contentRevision };
};
