import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type { MailboxGrantRole } from "@quieter/database/schema";
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
  manager: 3,
  reader: 1,
  responder: 2,
};

export const getStrongestMailboxGrantRole = (
  roles: (MailboxGrantRole | null | undefined)[]
): MailboxGrantRole | null => {
  let strongestRole: MailboxGrantRole | null = null;
  for (const role of roles) {
    if (role === undefined || role === null) {
      continue;
    }
    if (
      strongestRole === undefined ||
      strongestRole === null ||
      mailboxRoleRank[role] > mailboxRoleRank[strongestRole]
    ) {
      strongestRole = role;
    }
  }
  return strongestRole;
};

const roleSatisfies = (
  role: MailboxGrantRole,
  requiredRoles?: MailboxGrantRole[]
) =>
  requiredRoles === undefined ||
  requiredRoles.length === 0 ||
  requiredRoles.some(
    (requiredRole) => mailboxRoleRank[role] >= mailboxRoleRank[requiredRole]
  );

export const assertOwnedGmailMailbox = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const [gmailMailbox] = await db
    .select({ id: mailbox.id, organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL)
      )
    )
    .limit(1);
  if (gmailMailbox === undefined) {
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
      contentRevision: mailbox.contentRevision,
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
      and(
        eq(member.userId, input.userId),
        eq(member.organizationId, mailbox.organizationId)
      )
    )
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailboxGrant.userId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED)
      )
    );

  const divisionRows = await db
    .select({
      contentRevision: mailbox.contentRevision,
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      provider: mailbox.provider,
      role: mailboxDivisionGrant.role,
    })
    .from(mailboxDivisionGrant)
    .innerJoin(mailbox, eq(mailbox.id, mailboxDivisionGrant.mailboxId))
    .innerJoin(
      organizationDivision,
      eq(organizationDivision.id, mailboxDivisionGrant.divisionId)
    )
    .innerJoin(
      organizationDivisionMember,
      eq(organizationDivisionMember.divisionId, organizationDivision.id)
    )
    .innerJoin(
      member,
      and(
        eq(member.id, organizationDivisionMember.memberId),
        eq(member.userId, input.userId),
        eq(member.organizationId, mailbox.organizationId)
      )
    )
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
        eq(organizationDivision.organizationId, mailbox.organizationId)
      )
    );

  const selectedMailbox = directRows[0] ?? divisionRows[0] ?? null;
  const effectiveRole = getStrongestMailboxGrantRole([
    ...directRows.map((row) => row.role),
    ...divisionRows.map((row) => row.role),
  ]);

  if (
    selectedMailbox === null ||
    effectiveRole === null ||
    !roleSatisfies(effectiveRole, input.requiredRoles)
  ) {
    throw new ORPCError("NOT_FOUND", { message: "Managed mailbox not found." });
  }

  return { ...selectedMailbox, role: effectiveRole };
};
