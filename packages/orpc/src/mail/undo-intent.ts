import { ORPCError } from "@orpc/server";
import type { DatabaseTransaction } from "@quieter/database/client";
import { mailbox, mailMessageIntent } from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { mailUndoCurrentMessageSchema } from "./undo-model";

const intentAdvanceSchema = z.strictObject({
  facet: z.enum(["read", "destination"]),
  mailboxId: mailUndoCurrentMessageSchema.shape.mailboxId,
  messageIds: z
    .array(mailUndoCurrentMessageSchema.shape.messageId)
    .max(1000)
    .transform((ids) => [...new Set(ids)].toSorted()),
  token: z.uuid(),
});

export const advanceMailMessageIntents = async ({
  database,
  ...input
}: z.input<typeof intentAdvanceSchema> & {
  database: DatabaseTransaction;
}): Promise<void> => {
  const { facet, mailboxId, messageIds, token } =
    intentAdvanceSchema.parse(input);
  if (messageIds.length === 0) {
    return;
  }
  const [lockedMailbox] = await database
    .select({ id: mailbox.id })
    .from(mailbox)
    .where(eq(mailbox.id, mailboxId))
    .for("update");
  if (lockedMailbox === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "This inbox is no longer available.",
    });
  }
  const values =
    facet === "read"
      ? { readIntentToken: token, updatedAt: new Date() }
      : { destinationIntentToken: token, updatedAt: new Date() };
  await database
    .insert(mailMessageIntent)
    .values(
      messageIds.map((messageId) => ({ ...values, mailboxId, messageId }))
    )
    .onConflictDoUpdate({
      set: values,
      target: [mailMessageIntent.mailboxId, mailMessageIntent.messageId],
    });
};
