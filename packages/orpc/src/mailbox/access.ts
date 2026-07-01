import type { MailboxGrantRole } from "@quieter/database/schema";
import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxDivisionGrant,
  mailboxGrant,
  member,
  organizationDivision,
  organizationDivisionMember,
} from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";

export const MAILBOX_PROVIDER_GMAIL = "gmail" as const;
export const MAILBOX_PROVIDER_MANAGED = "managed" as const;

const mailboxRoleRank: Record<MailboxGrantRole, number> = {
  reader: 1,
  responder: 2,
  manager: 3,
};

export const getStrongestMailboxGrantRole = (
  roles: Array<MailboxGrantRole | null | undefined>,
): MailboxGrantRole | null =>
  roles.reduce<MailboxGrantRole | null>((strongestRole, role) => {
    if (!role) return strongestRole;
    if (!strongestRole || mailboxRoleRank[role] > mailboxRoleRank[strongestRole]) {
      return role;
    }
    return strongestRole;
  }, null);

const roleSatisfies = (role: MailboxGrantRole, requiredRoles?: MailboxGrantRole[]) =>
  !requiredRoles?.length ||
  requiredRoles.some((requiredRole) => mailboxRoleRank[role] >= mailboxRoleRank[requiredRole]);

export const assertOwnedGmailMailbox = async (input: { mailboxId: string; userId: string }) => {
  const [gmailMailbox] = await db
    .select({ id: mailbox.id, organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL),
      ),
    )
    .limit(1);
  if (!gmailMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
  }
  return gmailMailbox;
};

export const getAuthorizedManagedMailbox = async (input: {
  mailboxId: string;
  requiredRoles?: MailboxGrantRole[];
  userId: string;
}) => {
  const directRows = await db
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
      ),
    );

  const divisionRows = await db
    .select({
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
      role: mailboxDivisionGrant.role,
    })
    .from(mailboxDivisionGrant)
    .innerJoin(mailbox, eq(mailbox.id, mailboxDivisionGrant.mailboxId))
    .innerJoin(organizationDivision, eq(organizationDivision.id, mailboxDivisionGrant.divisionId))
    .innerJoin(
      organizationDivisionMember,
      eq(organizationDivisionMember.divisionId, organizationDivision.id),
    )
    .innerJoin(
      member,
      and(
        eq(member.id, organizationDivisionMember.memberId),
        eq(member.userId, input.userId),
        eq(member.organizationId, mailbox.organizationId),
      ),
    )
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
        eq(organizationDivision.organizationId, mailbox.organizationId),
      ),
    );

  const selectedMailbox = directRows[0] ?? divisionRows[0] ?? null;
  const effectiveRole = getStrongestMailboxGrantRole([
    ...directRows.map((row) => row.role),
    ...divisionRows.map((row) => row.role),
  ]);

  if (!selectedMailbox || !effectiveRole || !roleSatisfies(effectiveRole, input.requiredRoles)) {
    throw new ORPCError("NOT_FOUND", { message: "Managed mailbox not found." });
  }

  return { ...selectedMailbox, role: effectiveRole };
};
