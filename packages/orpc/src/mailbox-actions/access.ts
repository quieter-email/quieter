import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailbox } from "@quieter/database/schema";
import { eq } from "drizzle-orm";

import {
  getAuthorizedManagedMailbox,
  MAILBOX_PROVIDER_GMAIL,
} from "../mailbox/access";

export const assertMailboxActionConfigurator = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const [record] = await db
    .select({
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      ownerUserId: mailbox.ownerUserId,
      provider: mailbox.provider,
    })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);

  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }

  if (record.provider === MAILBOX_PROVIDER_GMAIL) {
    if (record.ownerUserId !== input.userId) {
      throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
    }
    return record;
  }

  await getAuthorizedManagedMailbox({
    mailboxId: input.mailboxId,
    requiredRoles: ["manager"],
    userId: input.userId,
  });
  return record;
};
