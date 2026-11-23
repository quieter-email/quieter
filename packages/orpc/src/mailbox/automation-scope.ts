import { db } from "@quieter/database/client";
import { mailbox } from "@quieter/database/schema";
import type { PersistedMailboxProvider } from "@quieter/database/schema";
import { and, eq, exists } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export type MailboxAutomationScope = {
  mailboxId?: string;
  provider?: PersistedMailboxProvider;
};

export const mailboxAutomationFilter = (
  mailboxId: AnyPgColumn,
  scope: MailboxAutomationScope
) =>
  and(
    scope.mailboxId === undefined ? undefined : eq(mailboxId, scope.mailboxId),
    scope.provider === undefined
      ? undefined
      : exists(
          db
            .select({ id: mailbox.id })
            .from(mailbox)
            .where(
              and(
                eq(mailbox.id, mailboxId),
                eq(mailbox.provider, scope.provider)
              )
            )
        )
  );
