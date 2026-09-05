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
import { and, eq, isNull } from "drizzle-orm";

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

/**
 * The single decision point for managed mailbox access. Division roles only
 * reach this function for shared mailboxes; the caller filters private ones.
 * Owning a private managed mailbox implies manager-level access so ownership
 * can never be accidentally revoked through grant changes.
 */
export const resolveManagedMailboxAccess = (input: {
  divisionRoles: MailboxGrantRole[];
  directRoles: MailboxGrantRole[];
  hasCandidateRow: boolean;
  isOwner: boolean;
  requiredRoles?: MailboxGrantRole[];
}): MailboxGrantRole | null => {
  if (!input.hasCandidateRow && !input.isOwner) {
    return null;
  }
  const effectiveRole = getStrongestMailboxGrantRole([
    ...input.directRoles,
    ...input.divisionRoles,
    ...(input.isOwner ? (["manager"] as const) : []),
  ]);
  if (
    effectiveRole === null ||
    !roleSatisfies(effectiveRole, input.requiredRoles)
  ) {
    return null;
  }
  return effectiveRole;
};

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

export const getAuthorizedManagedMailbox = async (
  input: {
    mailboxId: string;
    requiredRoles?: MailboxGrantRole[];
    userId: string;
  },
  database: Pick<typeof db, "select"> = db
) => {
  const directRows = await database
    .select({
      contentRevision: mailbox.contentRevision,
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      ownerUserId: mailbox.managedOwnerUserId,
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

  const divisionRows = await database
    .select({
      contentRevision: mailbox.contentRevision,
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      ownerUserId: mailbox.managedOwnerUserId,
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
        // Private managed mailboxes never grant access through divisions;
        // organization membership alone must never reveal the mailbox.
        isNull(mailbox.managedOwnerUserId),
        eq(organizationDivision.organizationId, mailbox.organizationId)
      )
    );

  const selectedMailbox = directRows[0] ?? divisionRows[0] ?? null;
  const effectiveRole = resolveManagedMailboxAccess({
    directRoles: directRows.map((row) => row.role),
    divisionRoles: divisionRows.map((row) => row.role),
    hasCandidateRow: selectedMailbox !== null,
    isOwner: selectedMailbox?.ownerUserId === input.userId,
    requiredRoles: input.requiredRoles,
  });

  if (selectedMailbox !== null && effectiveRole !== null) {
    return { ...selectedMailbox, role: effectiveRole };
  }

  // The owner of a private managed mailbox keeps full access even without a
  // grant row, so ownership can never be accidentally revoked.
  const [ownedPrivateMailbox] = await database
    .select({
      contentRevision: mailbox.contentRevision,
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
      ownerUserId: mailbox.managedOwnerUserId,
      provider: mailbox.provider,
    })
    .from(mailbox)
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
        eq(mailbox.managedOwnerUserId, input.userId),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED)
      )
    )
    .limit(1);
  if (
    ownedPrivateMailbox === undefined ||
    resolveManagedMailboxAccess({
      directRoles: [],
      divisionRoles: [],
      hasCandidateRow: true,
      isOwner: true,
      requiredRoles: input.requiredRoles,
    }) === null
  ) {
    throw new ORPCError("NOT_FOUND", { message: "Managed mailbox not found." });
  }

  return { ...ownedPrivateMailbox, role: "manager" as const };
};
