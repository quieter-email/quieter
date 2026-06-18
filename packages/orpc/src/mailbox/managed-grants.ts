import type { MailboxGrantRole } from "@quieter/database";
import { ORPCError } from "@orpc/server";
import { db, mailbox, mailboxGrant, member } from "@quieter/database";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { MAILBOX_PROVIDER_MANAGED } from "./access";

const normalizeEmailAddress = (emailAddress: string) => emailAddress.trim().toLowerCase();

export const createManagedMailbox = async (input: {
  displayName?: string | null;
  emailAddress: string;
  organizationId: string;
  userId: string;
}) => {
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, input.userId), eq(member.organizationId, input.organizationId)))
    .limit(1);
  if (!membership || !["admin", "owner"].includes(membership.role)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only organization owners and admins can create managed mailboxes.",
    });
  }

  const mailboxId = randomUUID();
  const now = new Date();
  await db.batch([
    db.insert(mailbox).values({
      createdAt: now,
      displayName: input.displayName?.trim() || null,
      emailAddress: normalizeEmailAddress(input.emailAddress),
      id: mailboxId,
      organizationId: input.organizationId,
      ownerUserId: null,
      provider: MAILBOX_PROVIDER_MANAGED,
      status: "connected",
      updatedAt: now,
    }),
    db.insert(mailboxGrant).values({
      createdAt: now,
      id: randomUUID(),
      mailboxId,
      role: "manager",
      updatedAt: now,
      userId: input.userId,
    }),
  ]);
  return { mailboxId };
};

const assertManagedMailboxManager = async (mailboxId: string, userId: string) => {
  const [grant] = await db
    .select({ id: mailboxGrant.id })
    .from(mailboxGrant)
    .innerJoin(mailbox, eq(mailbox.id, mailboxGrant.mailboxId))
    .innerJoin(
      member,
      and(eq(member.userId, userId), eq(member.organizationId, mailbox.organizationId)),
    )
    .where(
      and(
        eq(mailboxGrant.mailboxId, mailboxId),
        eq(mailboxGrant.userId, userId),
        eq(mailboxGrant.role, "manager"),
        eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED),
      ),
    )
    .limit(1);
  if (!grant) {
    throw new ORPCError("FORBIDDEN", { message: "Mailbox manager access is required." });
  }
};

export const setManagedMailboxGrant = async (input: {
  mailboxId: string;
  role: MailboxGrantRole;
  targetUserId: string;
  userId: string;
}) => {
  await assertManagedMailboxManager(input.mailboxId, input.userId);
  const [target] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .innerJoin(
      member,
      and(eq(member.organizationId, mailbox.organizationId), eq(member.userId, input.targetUserId)),
    )
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (!target) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Mailbox grants can only be assigned to organization members.",
    });
  }

  const now = new Date();
  await db
    .insert(mailboxGrant)
    .values({
      createdAt: now,
      id: randomUUID(),
      mailboxId: input.mailboxId,
      role: input.role,
      updatedAt: now,
      userId: input.targetUserId,
    })
    .onConflictDoUpdate({
      set: { role: input.role, updatedAt: now },
      target: [mailboxGrant.mailboxId, mailboxGrant.userId],
    });
  return { mailboxId: input.mailboxId, role: input.role, userId: input.targetUserId };
};

export const removeManagedMailboxGrant = async (input: {
  mailboxId: string;
  targetUserId: string;
  userId: string;
}) => {
  await assertManagedMailboxManager(input.mailboxId, input.userId);
  const managerGrants = await db
    .select({ userId: mailboxGrant.userId })
    .from(mailboxGrant)
    .where(and(eq(mailboxGrant.mailboxId, input.mailboxId), eq(mailboxGrant.role, "manager")));
  if (
    input.targetUserId === input.userId &&
    managerGrants.length === 1 &&
    managerGrants[0]?.userId === input.userId
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Assign another mailbox manager before removing the last manager.",
    });
  }

  await db
    .delete(mailboxGrant)
    .where(
      and(eq(mailboxGrant.mailboxId, input.mailboxId), eq(mailboxGrant.userId, input.targetUserId)),
    );
  return { removed: true };
};
