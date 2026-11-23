import { db } from "@quieter/database/client";
import { gmailCapturedMessage } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";

import {
  finishGmailCapturedBody,
  hydrateGmailCapturedSnapshot,
  stageGmailCapturedBody,
} from "./gmail-captured-body";

export const backfillGmailCapturedBodies = async () => {
  if (serverEnv.GMAIL_BODY_STORAGE_ENABLED !== true) {
    return { migrated: 0, scanned: 0 };
  }
  const pending = and(
    isNull(gmailCapturedMessage.bodyObject),
    isNull(gmailCapturedMessage.deletedAt),
    isNotNull(gmailCapturedMessage.snapshot)
  );
  const dueAt = sql`coalesce(${gmailCapturedMessage.bodyBackfillAfter}, '-infinity'::timestamp)`;
  const rows = await db
    .select({
      bodyObject: gmailCapturedMessage.bodyObject,
      mailboxId: gmailCapturedMessage.mailboxId,
      messageId: gmailCapturedMessage.messageId,
      providerRevision: gmailCapturedMessage.providerRevision,
      snapshot: gmailCapturedMessage.snapshot,
    })
    .from(gmailCapturedMessage)
    .where(and(pending, lte(dueAt, sql`timezone('UTC', now())`)))
    .orderBy(
      asc(dueAt),
      asc(gmailCapturedMessage.mailboxId),
      asc(gmailCapturedMessage.messageId)
    )
    .limit(16);

  let migrated = 0;
  for (const row of rows) {
    try {
      const snapshot = await hydrateGmailCapturedSnapshot(row);
      if (snapshot === null) {
        continue;
      }
      const staged = await stageGmailCapturedBody(row, {
        ...snapshot,
        providerRevision: row.providerRevision,
      });
      // Preserve the exact legacy metadata, including its snapshot revision.
      const { bodyObject, bodySearchDocument, bodySearchText } = staged.columns;
      const accepted = await db.transaction(async (tx) => {
        const updated = await tx
          .update(gmailCapturedMessage)
          .set({
            bodyBackfillAfter: null,
            bodyObject,
            bodySearchDocument,
            bodySearchText,
            snapshot: sql`${gmailCapturedMessage.snapshot} - array['bodyText','bodyHtml']`,
          })
          .where(
            and(
              pending,
              eq(gmailCapturedMessage.mailboxId, row.mailboxId),
              eq(gmailCapturedMessage.messageId, row.messageId),
              eq(gmailCapturedMessage.providerRevision, row.providerRevision),
              sql`${gmailCapturedMessage.snapshot} = ${JSON.stringify(row.snapshot)}::text::jsonb`
            )
          )
          .returning({ messageId: gmailCapturedMessage.messageId });
        if (updated.length > 0) {
          await finishGmailCapturedBody(tx, staged);
        }
        return updated.length;
      });
      migrated += accepted;
    } catch (error) {
      reportError(error, { operation: "gmail:body-backfill" });
      await db
        .update(gmailCapturedMessage)
        .set({ bodyBackfillAfter: new Date(Date.now() + 10 * 60 * 1000) })
        .where(
          and(
            pending,
            eq(gmailCapturedMessage.mailboxId, row.mailboxId),
            eq(gmailCapturedMessage.messageId, row.messageId),
            eq(gmailCapturedMessage.providerRevision, row.providerRevision)
          )
        );
    }
  }
  return { migrated, scanned: rows.length };
};
