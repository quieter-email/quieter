import { db } from "@quieter/database/client";
import {
  gmailAutoLabelSettings,
  mailboxAutomationSettings,
} from "@quieter/database/schema";

import {
  assertAccessibleMailbox,
  getAuthorizedManagedMailbox,
} from "../mailbox/service";

export const setMailboxAutoLabeling = async (input: {
  enabled: boolean;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertAccessibleMailbox({
    mailboxId: input.mailboxId,
    userId: input.userId,
  });

  if (selectedMailbox.provider === "managed") {
    await getAuthorizedManagedMailbox({
      mailboxId: input.mailboxId,
      requiredRoles: ["manager"],
      userId: input.userId,
    });
  }

  const now = new Date();
  await db
    .insert(mailboxAutomationSettings)
    .values({
      autoLabelEnabled: input.enabled,
      createdAt: now,
      mailboxId: input.mailboxId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: { autoLabelEnabled: input.enabled, updatedAt: now },
      target: mailboxAutomationSettings.mailboxId,
    });

  if (selectedMailbox.provider === "gmail") {
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
  }

  return { enabled: input.enabled, mailboxId: input.mailboxId };
};
