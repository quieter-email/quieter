import { assertUserBillingFeature } from "@quieter/billing/entitlements";
import { db, gmailUsefulDetail, gmailUsefulDetailSettings } from "@quieter/database";
import { eq } from "drizzle-orm";
import { assertOwnedGmailMailbox } from "../mailbox/access";

export const setGmailUsefulDetails = async (input: {
  enabled: boolean;
  mailboxId: string;
  userId: string;
}) => {
  await assertOwnedGmailMailbox(input);
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
