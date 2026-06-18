import { assertUserBillingFeature } from "@quieter/billing/entitlements";
import { db, gmailAutoLabelSettings } from "@quieter/database";
import { assertOwnedGmailMailbox } from "../mailbox/access";

export const setGmailAutoLabeling = async (input: {
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
