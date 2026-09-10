import { mailbox, mailSyncEntity } from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";

import { mailSyncServices } from "./mail-sync-runtime";

export const markSyncMailboxNeedsReconnect = async (mailboxId: string) => {
  await mailSyncServices().repository.transaction(
    mailboxId,
    async (context) => {
      await context.database
        .update(mailbox)
        .set({ status: "needs_reconnect", updatedAt: new Date() })
        .where(eq(mailbox.id, mailboxId));
      const [previous] = await context.database
        .select({ data: mailSyncEntity.data })
        .from(mailSyncEntity)
        .where(
          and(
            eq(mailSyncEntity.mailboxId, mailboxId),
            eq(mailSyncEntity.kind, "overview"),
            eq(mailSyncEntity.entityId, mailboxId)
          )
        );
      context.put({
        data: {
          kind: "overview",
          value: {
            counts:
              previous?.data?.kind === "overview"
                ? previous.data.value.counts
                : {},
            status: "needs_reconnect",
          },
        },
        id: mailboxId,
        kind: "overview",
      });
    }
  );
};
