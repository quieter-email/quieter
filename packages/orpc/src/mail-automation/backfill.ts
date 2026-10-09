import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailbox, mailboxAutomationSettings } from "@quieter/database/schema";
import { and, eq, sql } from "drizzle-orm";

import { labelExistingGmailInboxBatch } from "../gmail-sync/service";
import { publishMailUpdate } from "../mail-updates";
import {
  assertAccessibleMailbox,
  getAuthorizedManagedMailbox,
} from "../mailbox/service";
import { labelExistingManagedInboxBatch } from "../managed-mail/automation";
import { assertMailAutomationAiBudget } from "./ai-budget";

export const labelExistingMailboxInboxBatch = async (input: {
  cursor?: { before: string; pageToken: string; scanned: number };
  mailboxId: string;
  userId: string;
}) => {
  const selected = await assertAccessibleMailbox(input);
  if (selected.provider === "managed") {
    await getAuthorizedManagedMailbox({ ...input, requiredRoles: ["manager"] });
  }
  const [settings] = await db
    .select({ enabled: mailboxAutomationSettings.autoLabelEnabled })
    .from(mailboxAutomationSettings)
    .where(eq(mailboxAutomationSettings.mailboxId, input.mailboxId))
    .limit(1);
  if (!settings?.enabled) {
    throw new ORPCError("FORBIDDEN", {
      message: "Enable automatic labeling in mailbox settings first.",
    });
  }
  const now = Date.now();
  const requestedBefore = input.cursor
    ? new Date(input.cursor.before).getTime()
    : now;
  const recentFloor = now - 1000 * 60 * 60 * 24 * 7;
  if (requestedBefore < recentFloor) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This labeling run has expired. Please start again.",
    });
  }
  const beforeTime = Math.min(requestedBefore, now);
  const before = new Date(beforeTime).toISOString();
  const previousScanned = input.cursor?.scanned ?? 0;
  let changed = false;
  const batchInput = {
    after: new Date(beforeTime - 1000 * 60 * 60 * 24 * 7).toISOString(),
    before,
    limit: Math.min(10, 100 - previousScanned),
    mailboxId: input.mailboxId,
    onApplied: () => {
      changed = true;
    },
    pageToken: input.cursor?.pageToken,
  };
  if (selected.provider === "gmail") {
    await assertMailAutomationAiBudget({
      organizationId: selected.organizationId,
      userId: input.userId,
    });
  }
  try {
    const result =
      selected.provider === "gmail"
        ? await labelExistingGmailInboxBatch({
            ...batchInput,
            organizationId: selected.organizationId,
            userId: input.userId,
          })
        : await labelExistingManagedInboxBatch(batchInput);
    return {
      cursor:
        result.nextPageToken && previousScanned + result.scanned < 100
          ? {
              before,
              pageToken: result.nextPageToken,
              scanned: previousScanned + result.scanned,
            }
          : null,
      labeled: result.labeled,
      scanned: result.scanned,
    };
  } finally {
    if (changed) {
      if (selected.provider === "managed") {
        await db
          .update(mailbox)
          .set({
            contentRevision: sql`${mailbox.contentRevision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mailbox.id, input.mailboxId),
              eq(mailbox.provider, "managed")
            )
          );
      }
      await publishMailUpdate({
        mailboxId: input.mailboxId,
        type: "mailbox.changed",
      });
    }
  }
};
