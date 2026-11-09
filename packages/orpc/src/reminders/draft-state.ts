import { db } from "@quieter/database/client";
import { gmailComposeOperation } from "@quieter/database/schema";
import type { FollowUpReminderIntent } from "@quieter/mail/reminders";
import { and, eq } from "drizzle-orm";

export const saveDraftReminderIntent = async (input: {
  mailboxId: string;
  userId: string;
  draftId: string;
  intent?: FollowUpReminderIntent;
}) => {
  const now = new Date();
  const metadata = input.intent
    ? { intent: input.intent, userId: input.userId }
    : null;
  await db
    .insert(gmailComposeOperation)
    .values({
      createdAt: now,
      draftId: input.draftId,
      followUpReminder: metadata,
      id: crypto.randomUUID(),
      kind: "save",
      mailboxId: input.mailboxId,
      messageHeaderId: "<metadata@compose.quieter.email>",
      operationKey: `reminder-draft:${input.userId}:${input.draftId}`,
      requestHash: "reminder-metadata",
      status: "accepted",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: { followUpReminder: metadata, updatedAt: now },
      target: [
        gmailComposeOperation.mailboxId,
        gmailComposeOperation.operationKey,
      ],
    });
};

export const loadDraftReminderIntent = async (input: {
  mailboxId: string;
  userId: string;
  draftId: string;
}) => {
  const [row] = await db
    .select({ metadata: gmailComposeOperation.followUpReminder })
    .from(gmailComposeOperation)
    .where(
      and(
        eq(gmailComposeOperation.mailboxId, input.mailboxId),
        eq(
          gmailComposeOperation.operationKey,
          `reminder-draft:${input.userId}:${input.draftId}`
        )
      )
    )
    .limit(1);
  return row?.metadata?.userId === input.userId
    ? row.metadata.intent
    : undefined;
};
