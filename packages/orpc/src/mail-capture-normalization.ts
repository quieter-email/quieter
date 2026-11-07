import { db } from "@quieter/database/client";
import {
  gmailCapturedMessage,
  managedMailMessage,
  semanticEmbedding,
} from "@quieter/database/schema";
import { analyzeMailMessage } from "@quieter/mail/capture";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { assertAccessibleMailbox } from "./mailbox/service";

export const normalizeCapturedMailMetadata = async (input: {
  mailboxId: string;
  userId: string;
  signal?: AbortSignal;
}) => {
  input.signal?.throwIfAborted();
  const mailbox = await assertAccessibleMailbox(input);
  if (mailbox.provider === "gmail") {
    const rows = await db
      .select()
      .from(gmailCapturedMessage)
      .where(
        and(
          eq(gmailCapturedMessage.mailboxId, input.mailboxId),
          isNull(gmailCapturedMessage.deletedAt),
          sql`not (coalesce(${gmailCapturedMessage.snapshot}->'labelIds', '[]'::jsonb) ?| array['DRAFT', 'SPAM', 'TRASH'])`,
          sql`${gmailCapturedMessage.analysis}->>'version' = '1'`
        )
      )
      .orderBy(
        desc(gmailCapturedMessage.capturedAt),
        asc(gmailCapturedMessage.messageId)
      )
      .limit(16);
    for (const row of rows) {
      input.signal?.throwIfAborted();
      if (row.snapshot === null || row.analysis === null) {
        continue;
      }
      const analysis = analyzeMailMessage(row.snapshot);
      analysis.truncated ||= Object.values(row.snapshot.truncation).some(
        Boolean
      );
      await assertAccessibleMailbox(input);
      await db.transaction(async (tx) => {
        const accepted = await tx
          .update(gmailCapturedMessage)
          .set({ analysis })
          .where(
            and(
              eq(gmailCapturedMessage.mailboxId, input.mailboxId),
              eq(gmailCapturedMessage.messageId, row.messageId),
              eq(gmailCapturedMessage.providerRevision, row.providerRevision),
              isNull(gmailCapturedMessage.deletedAt),
              sql`${gmailCapturedMessage.snapshot} = ${JSON.stringify(row.snapshot)}::jsonb`,
              sql`${gmailCapturedMessage.analysis} = ${JSON.stringify(row.analysis)}::jsonb`
            )
          )
          .returning({ messageId: gmailCapturedMessage.messageId });
        if (accepted.length > 0) {
          await tx
            .delete(semanticEmbedding)
            .where(
              and(
                eq(semanticEmbedding.gmailMailboxId, input.mailboxId),
                eq(semanticEmbedding.gmailMessageId, row.messageId)
              )
            );
        }
      });
    }
    return;
  }
  const rows = await db
    .select()
    .from(managedMailMessage)
    .where(
      and(
        eq(managedMailMessage.mailboxId, input.mailboxId),
        inArray(managedMailMessage.mailboxState, ["active", "archived"]),
        or(
          isNull(managedMailMessage.analysis),
          sql`${managedMailMessage.analysis}->>'version' = '1'`
        )
      )
    )
    .orderBy(desc(managedMailMessage.sentAt), asc(managedMailMessage.id))
    .limit(16);
  for (const row of rows) {
    input.signal?.throwIfAborted();
    const analysis = analyzeMailMessage(row);
    await assertAccessibleMailbox(input);
    await db.transaction(async (tx) => {
      const accepted = await tx
        .update(managedMailMessage)
        .set({ analysis })
        .where(
          and(
            eq(managedMailMessage.mailboxId, input.mailboxId),
            eq(managedMailMessage.id, row.id),
            inArray(managedMailMessage.mailboxState, ["active", "archived"]),
            sql`${managedMailMessage.subject} is not distinct from ${row.subject}`,
            sql`${managedMailMessage.bodyText} is not distinct from ${row.bodyText}`,
            sql`${managedMailMessage.bodyHtml} is not distinct from ${row.bodyHtml}`,
            sql`${managedMailMessage.headers} = ${JSON.stringify(row.headers)}::jsonb`,
            eq(managedMailMessage.from, row.from),
            row.analysis === null
              ? isNull(managedMailMessage.analysis)
              : sql`${managedMailMessage.analysis} = ${JSON.stringify(row.analysis)}::jsonb`
          )
        )
        .returning({ id: managedMailMessage.id });
      if (accepted.length > 0) {
        await tx
          .delete(semanticEmbedding)
          .where(eq(semanticEmbedding.managedMessageId, row.id));
      }
    });
  }
};
