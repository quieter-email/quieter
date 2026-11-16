import { ORPCError } from "@orpc/server";
import type { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxDivisionGrant,
  mailboxGrant,
  member,
} from "@quieter/database/schema";
import { and, eq, ne } from "drizzle-orm";

export const assertPrivateMailContext = async (
  tx: Pick<typeof db, "select">,
  input: { mailboxId: string; privateContext?: boolean; userId: string }
) => {
  if (input.privateContext !== true) {
    return;
  }
  const [record] = await tx
    .select({
      accessMode: mailbox.accessMode,
      ownerId: mailbox.managedOwnerUserId,
      ownerUserId: mailbox.ownerUserId,
      provider: mailbox.provider,
    })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .for("no key update");
  if (record?.provider === "gmail" && record.ownerUserId === input.userId) {
    return;
  }
  const [otherGrant] = await tx
    .select({ id: mailboxGrant.id })
    .from(mailboxGrant)
    .innerJoin(
      member,
      and(
        eq(member.id, mailboxGrant.memberId),
        eq(member.userId, mailboxGrant.userId)
      )
    )
    .innerJoin(
      mailbox,
      and(
        eq(mailbox.id, mailboxGrant.mailboxId),
        eq(mailbox.organizationId, member.organizationId)
      )
    )
    .where(
      and(
        eq(mailboxGrant.mailboxId, input.mailboxId),
        ne(mailboxGrant.userId, input.userId)
      )
    )
    .limit(1);
  const [divisionGrant] = await tx
    .select({ id: mailboxDivisionGrant.id })
    .from(mailboxDivisionGrant)
    .where(eq(mailboxDivisionGrant.mailboxId, input.mailboxId))
    .limit(1);
  if (
    record?.accessMode !== "private" ||
    record.ownerId !== input.userId ||
    otherGrant !== undefined ||
    divisionGrant !== undefined
  ) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Personal context cannot be used for changes in a shared inbox. Review this request again.",
    });
  }
};
