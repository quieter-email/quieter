import { db } from "@quieter/database/client";
import {
  gmailAutoLabelSettings,
  gmailUsefulDetail,
  gmailUsefulDetailSettings,
  mailboxAutomationSettings,
} from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import { assertAccessibleMailbox, getAuthorizedManagedMailbox } from "../mailbox/service";
import { assertMailAutomationAiBudget } from "./ai-budget";

const assertAutomationAccess = async (input: {
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

  if (input.enabled) {
    await assertMailAutomationAiBudget({
      organizationId: selectedMailbox.organizationId ?? undefined,
      userId: input.userId,
    });
  }

  return selectedMailbox;
};

export const setMailboxAutoLabeling = async (input: {
  enabled: boolean;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertAutomationAccess(input);
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

export const setMailboxUsefulDetails = async (input: {
  enabled: boolean;
  mailboxId: string;
  userId: string;
}) => {
  const selectedMailbox = await assertAutomationAccess(input);
  const now = new Date();
  await db
    .insert(mailboxAutomationSettings)
    .values({
      createdAt: now,
      mailboxId: input.mailboxId,
      updatedAt: now,
      usefulDetailsEnabled: input.enabled,
    })
    .onConflictDoUpdate({
      set: { usefulDetailsEnabled: input.enabled, updatedAt: now },
      target: mailboxAutomationSettings.mailboxId,
    });

  if (selectedMailbox.provider === "gmail") {
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
  }

  if (!input.enabled) {
    await db.delete(gmailUsefulDetail).where(eq(gmailUsefulDetail.mailboxId, input.mailboxId));
  }

  return { enabled: input.enabled, mailboxId: input.mailboxId };
};
