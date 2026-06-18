import { ORPCError } from "@orpc/server";
import { assertUserBillingFeature } from "@quieter/billing/entitlements";
import { db, gmailAutoLabelSettings, mailbox } from "@quieter/database";
import { and, eq } from "drizzle-orm";

export const setGmailAutoLabeling = async (input: {
  enabled: boolean;
  mailboxId: string;
  userId: string;
}) => {
  const [gmailMailbox] = await db
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, "gmail"),
      ),
    )
    .limit(1);
  if (!gmailMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
  }
  if (input.enabled) {
    await assertUserBillingFeature({
      feature: "gmailAutomation",
      userId: input.userId,
    });
  }

  const now = new Date();
  await db
    .insert(gmailAutoLabelSettings)
    .values({
      createdAt: now,
      enabled: input.enabled,
      mailboxId: input.mailboxId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: { enabled: input.enabled, updatedAt: now },
      target: gmailAutoLabelSettings.mailboxId,
    });
  return { enabled: input.enabled, mailboxId: input.mailboxId };
};
