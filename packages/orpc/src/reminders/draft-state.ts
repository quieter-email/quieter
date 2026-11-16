import { db } from "@quieter/database/client";
import { gmailComposeOperation, mailbox } from "@quieter/database/schema";
import type { FollowUpReminderIntent } from "@quieter/mail/reminders";
import { and, eq } from "drizzle-orm";

import { assertAiAuthority } from "../ai-authority";
import type { AiOperationOrigin } from "../ai-authority";
import type { MailEffectAssertion } from "../gmail-request";

export const saveDraftReminderIntent = async (input: {
  beforeEffect?: MailEffectAssertion;
  mailboxId: string;
  userId: string;
  draftId: string;
  intent?: FollowUpReminderIntent;
  origin?: AiOperationOrigin;
}) => {
  const now = new Date();
  const metadata = input.intent
    ? {
        intent: input.intent,
        origin: input.origin ?? { kind: "human" as const },
        userId: input.userId,
      }
    : null;
  await db.transaction(async (tx) => {
    await tx
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.id, input.mailboxId))
      .for("update");
    if (input.origin !== undefined) {
      await assertAiAuthority(
        {
          effect: "write",
          mailboxId: input.mailboxId,
          origin: input.origin,
          userId: input.userId,
        },
        tx
      );
    }
    await input.beforeEffect?.(tx);
    await tx
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
