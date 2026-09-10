import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import { mailbox, managedMailMessage } from "@quieter/database/schema";
import { projectManagedDelivery } from "@quieter/sync-server/delivery";
import { and, eq } from "drizzle-orm";

import { mailSyncServices } from "./mail-sync-runtime";

export const withDeliverySyncTransaction = async <Result>(
  organizationId: string,
  providerMessageId: string,
  run: (database: DatabaseTransaction) => Promise<Result>
) => {
  const messages = await db
    .select({
      id: managedMailMessage.id,
      mailboxId: managedMailMessage.mailboxId,
    })
    .from(managedMailMessage)
    .innerJoin(mailbox, eq(mailbox.id, managedMailMessage.mailboxId))
    .where(
      and(
        eq(mailbox.organizationId, organizationId),
        eq(managedMailMessage.direction, "outbound"),
        eq(managedMailMessage.providerMessageId, providerMessageId)
      )
    );
  const byMailbox = new Map<string, string[]>();
  for (const message of messages) {
    const ids = byMailbox.get(message.mailboxId) ?? [];
    ids.push(message.id);
    byMailbox.set(message.mailboxId, ids);
  }
  return await mailSyncServices().repository.transactionMany(
    [...byMailbox.keys()],
    async (database, contexts) => {
      const result = await run(database);
      for (const context of contexts.values()) {
        await projectManagedDelivery(
          context,
          byMailbox.get(context.mailboxId) ?? []
        );
      }
      return result;
    }
  );
};
