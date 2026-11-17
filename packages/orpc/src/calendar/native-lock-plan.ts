import type { DatabaseTransaction } from "@quieter/database/client";
import {
  connectorCredential,
  gmailCredential,
  mailbox,
} from "@quieter/database/schema";
import { asc, inArray } from "drizzle-orm";

export type CalendarNativeLockPlan = Readonly<{
  googleMailboxIds: readonly string[];
  microsoftConnectionIds: readonly string[];
}>;

export const lockCalendarNativeAccounts = async (input: {
  authorityMailboxId?: string;
  calendarLockPlan?: CalendarNativeLockPlan;
  executor: DatabaseTransaction;
  googleMailboxId?: string;
  microsoftConnectionId?: string;
}): Promise<void> => {
  const mailboxIds = [
    ...new Set([
      ...(input.calendarLockPlan?.googleMailboxIds ?? []),
      ...(input.authorityMailboxId === undefined
        ? []
        : [input.authorityMailboxId]),
      ...(input.googleMailboxId === undefined ? [] : [input.googleMailboxId]),
    ]),
  ];
  const microsoftConnectionIds = [
    ...new Set([
      ...(input.calendarLockPlan?.microsoftConnectionIds ?? []),
      ...(input.microsoftConnectionId === undefined
        ? []
        : [input.microsoftConnectionId]),
    ]),
  ];
  if (mailboxIds.length > 0) {
    await input.executor
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(inArray(mailbox.id, mailboxIds))
      .orderBy(asc(mailbox.id))
      .for("update");
    await input.executor
      .select({ mailboxId: gmailCredential.mailboxId })
      .from(gmailCredential)
      .where(inArray(gmailCredential.mailboxId, mailboxIds))
      .orderBy(asc(gmailCredential.mailboxId))
      .for("no key update");
  }
  if (microsoftConnectionIds.length > 0) {
    await input.executor
      .select({ id: connectorCredential.id })
      .from(connectorCredential)
      .where(inArray(connectorCredential.id, microsoftConnectionIds))
      .orderBy(asc(connectorCredential.id))
      .for("no key update");
  }
};
