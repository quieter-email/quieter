import { ORPCError } from "@orpc/server";
import { assertUserBillingFeature } from "@quieter/billing/entitlements";
import { db, gmailUsefulDetail, gmailUsefulDetailSettings, mailbox } from "@quieter/database";
import { and, eq } from "drizzle-orm";

export const setGmailUsefulDetails = async (input: {
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
    .insert(gmailUsefulDetailSettings)
    .values({
      createdAt: now,
      enabled: input.enabled,
      mailboxId: input.mailboxId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: { enabled: input.enabled, updatedAt: now },
      target: gmailUsefulDetailSettings.mailboxId,
    });
  if (!input.enabled) {
    await db.delete(gmailUsefulDetail).where(eq(gmailUsefulDetail.mailboxId, input.mailboxId));
  }
  return { enabled: input.enabled, mailboxId: input.mailboxId };
};
