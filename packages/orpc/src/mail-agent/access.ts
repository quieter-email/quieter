import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxDivisionGrant,
  mailboxGrant,
  member,
} from "@quieter/database/schema";
import { and, eq, ne } from "drizzle-orm";

import { getAuthorizedManagedMailbox } from "../mailbox/access";

export const assertAgentMailboxAccess = async (
  input: { mailboxId: string; userId: string; saveDraft?: boolean },
  database: Pick<typeof db, "select"> = db
) => {
  const [record] = await database
    .select({
      accessMode: mailbox.accessMode,
      managedOwnerUserId: mailbox.managedOwnerUserId,
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
  const authorized =
    record.provider === "managed"
      ? await getAuthorizedManagedMailbox(
          {
            ...input,
            requiredRoles: input.saveDraft === true ? ["responder"] : undefined,
          },
          database
        )
      : null;
  if (
    authorized === null &&
    (record.provider !== "gmail" || record.ownerUserId !== input.userId)
  ) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  const [membership] =
    record.provider === "managed"
      ? await database
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.organizationId, record.organizationId),
              eq(member.userId, input.userId)
            )
          )
          .limit(1)
      : [];
  if (record.provider === "managed" && membership === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  const otherGrants =
    record.provider === "managed"
      ? await database
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
    record.provider === "managed"
      ? await database
          .select({ id: mailboxDivisionGrant.id })
          .from(mailboxDivisionGrant)
          .where(eq(mailboxDivisionGrant.mailboxId, input.mailboxId))
          .limit(1)
      : [];
  return {
    canSaveDraft: authorized === null || authorized.role !== "reader",
    memberId: membership?.id ?? null,
    organizationId: record.organizationId,
    provider: record.provider,
    shared:
      record.provider === "managed" &&
      (record.accessMode === "shared" ||
        record.managedOwnerUserId !== input.userId ||
        otherGrants.length > 0 ||
        divisionGrants.length > 0),
  };
};
