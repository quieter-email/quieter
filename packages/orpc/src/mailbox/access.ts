import type { MailboxGrantRole } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { db, mailbox, mailboxGrant, member } from "@quieter/database";
import { and, eq, or } from "drizzle-orm";

export const MAILBOX_PROVIDER_GMAIL = "gmail" as const;
export const MAILBOX_PROVIDER_MANAGED = "managed" as const;

export const getAuthorizedManagedMailbox = async (input: {
  mailboxId: string;
  requiredRoles?: MailboxGrantRole[];
  userId: string;
}) => {
  const roleConditions = input.requiredRoles?.map((role) => eq(mailboxGrant.role, role));
  const [selectedMailbox] = await db
    .select({
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
      role: mailboxGrant.role,
    })
    .from(mailboxGrant)
    .innerJoin(mailbox, eq(mailbox.id, mailboxGrant.mailboxId))
    .innerJoin(
      member,
      and(eq(member.userId, input.userId), eq(member.organizationId, mailbox.organizationId)),
    )
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailboxGrant.userId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
        roleConditions?.length ? or(...roleConditions) : undefined,
      ),
    )
    .limit(1);

  if (!selectedMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Managed mailbox not found." });
  }

  return selectedMailbox;
};
