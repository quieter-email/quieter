import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxDivisionGrant,
  mailboxGrant,
} from "@quieter/database/schema";
import { and, eq, ne } from "drizzle-orm";

import { getAuthorizedManagedMailbox } from "../mailbox/access";
import { assertAccessibleMailbox } from "../mailbox/service";

export const assertAgentMailboxAccess = async (input: {
  mailboxId: string;
  userId: string;
  manage?: boolean;
}) => {
  const authorized = await assertAccessibleMailbox(input);
  if (input.manage === true && authorized.provider === "managed") {
    await getAuthorizedManagedMailbox({ ...input, requiredRoles: ["manager"] });
  }
  const [record] = await db
    .select({
      accessMode: mailbox.accessMode,
      managedOwnerUserId: mailbox.managedOwnerUserId,
    })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (record === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  const otherGrants =
    authorized.provider === "managed"
      ? await db
          .select({ id: mailboxGrant.id })
          .from(mailboxGrant)
          .where(
            and(
              eq(mailboxGrant.mailboxId, input.mailboxId),
              ne(mailboxGrant.userId, input.userId)
            )
          )
          .limit(1)
      : [];
  const divisionGrants =
    authorized.provider === "managed"
      ? await db
          .select({ id: mailboxDivisionGrant.id })
          .from(mailboxDivisionGrant)
          .where(eq(mailboxDivisionGrant.mailboxId, input.mailboxId))
          .limit(1)
      : [];
  return {
    ...authorized,
    shared:
      authorized.provider === "managed" &&
      (record.accessMode === "shared" ||
        record.managedOwnerUserId !== input.userId ||
        otherGrants.length > 0 ||
        divisionGrants.length > 0),
  };
};
