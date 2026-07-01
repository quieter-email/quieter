import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  mailbox,
  mailboxDivisionGrant,
  member,
  organizationDivision,
  organizationDivisionMember,
  user,
} from "@quieter/database/schema";
import { and, asc, count, eq, inArray, max, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const normalizeDivisionName = (name: string) => name.trim().replace(/\s+/g, " ");
const normalizeDivisionKey = (name: string) => normalizeDivisionName(name).toLowerCase();

const assertDivisionNameAvailable = async (input: {
  divisionId?: string;
  name: string;
  organizationId: string;
}) => {
  const [existingDivision] = await db
    .select({ id: organizationDivision.id })
    .from(organizationDivision)
    .where(
      and(
        eq(organizationDivision.organizationId, input.organizationId),
        eq(organizationDivision.normalizedName, normalizeDivisionKey(input.name)),
        input.divisionId ? ne(organizationDivision.id, input.divisionId) : undefined,
      ),
    )
    .limit(1);

  if (existingDivision) {
    throw new ORPCError("CONFLICT", { message: "A division with this name already exists." });
  }
};

const assertOrganizationMember = async (input: { organizationId: string; userId: string }) => {
  const [membership] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, input.organizationId), eq(member.userId, input.userId)))
    .limit(1);

  if (!membership) {
    throw new ORPCError("FORBIDDEN", { message: "You are not a member of that team." });
  }

  return membership;
};

export const assertOrganizationManager = async (input: {
  organizationId: string;
  userId: string;
}) => {
  const membership = await assertOrganizationMember(input);

  if (!["admin", "owner"].includes(membership.role)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only team owners and admins can manage divisions.",
    });
  }

  return membership;
};

const getDivisionWithManagerAccess = async (input: { divisionId: string; userId: string }) => {
  const [division] = await db
    .select({
      id: organizationDivision.id,
      organizationId: organizationDivision.organizationId,
    })
    .from(organizationDivision)
    .where(eq(organizationDivision.id, input.divisionId))
    .limit(1);

  if (!division) {
    throw new ORPCError("NOT_FOUND", { message: "Division not found." });
  }

  await assertOrganizationManager({
    organizationId: division.organizationId,
    userId: input.userId,
  });

  return division;
};

export const listOrganizationDivisions = async (input: {
  organizationId: string;
  userId: string;
}) => {
  await assertOrganizationMember(input);

  const [divisions, divisionMembers, mailboxCounts, grantCounts] = await Promise.all([
    db
      .select({
        description: organizationDivision.description,
        id: organizationDivision.id,
        name: organizationDivision.name,
        organizationId: organizationDivision.organizationId,
        position: organizationDivision.position,
      })
      .from(organizationDivision)
      .where(eq(organizationDivision.organizationId, input.organizationId))
      .orderBy(asc(organizationDivision.position), asc(organizationDivision.name)),
    db
      .select({
        divisionId: organizationDivisionMember.divisionId,
        email: user.email,
        memberId: member.id,
        name: user.name,
        role: member.role,
        userId: user.id,
      })
      .from(organizationDivisionMember)
      .innerJoin(member, eq(member.id, organizationDivisionMember.memberId))
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, input.organizationId))
      .orderBy(asc(user.name), asc(user.email)),
    db
      .select({ divisionId: mailbox.divisionId, value: count() })
      .from(mailbox)
      .where(and(eq(mailbox.organizationId, input.organizationId), eq(mailbox.provider, "managed")))
      .groupBy(mailbox.divisionId),
    db
      .select({ divisionId: mailboxDivisionGrant.divisionId, value: count() })
      .from(mailboxDivisionGrant)
      .innerJoin(mailbox, eq(mailbox.id, mailboxDivisionGrant.mailboxId))
      .where(and(eq(mailbox.organizationId, input.organizationId), eq(mailbox.provider, "managed")))
      .groupBy(mailboxDivisionGrant.divisionId),
  ]);

  const mailboxCountsByDivisionId = new Map(
    mailboxCounts.flatMap((row) => (row.divisionId ? [[row.divisionId, row.value]] : [])),
  );
  const grantCountsByDivisionId = new Map(grantCounts.map((row) => [row.divisionId, row.value]));

  return {
    divisions: divisions.map((division) => ({
      ...division,
      grantCount: grantCountsByDivisionId.get(division.id) ?? 0,
      mailboxCount: mailboxCountsByDivisionId.get(division.id) ?? 0,
      members: divisionMembers.filter(
        (divisionMember) => divisionMember.divisionId === division.id,
      ),
    })),
  };
};

export const createOrganizationDivision = async (input: {
  description?: string | null;
  name: string;
  organizationId: string;
  userId: string;
}) => {
  await assertOrganizationManager(input);

  const name = normalizeDivisionName(input.name);
  if (!name) {
    throw new ORPCError("BAD_REQUEST", { message: "Division name is required." });
  }
  await assertDivisionNameAvailable({ name, organizationId: input.organizationId });

  const [positionRow] = await db
    .select({ value: max(organizationDivision.position) })
    .from(organizationDivision)
    .where(eq(organizationDivision.organizationId, input.organizationId));
  const now = new Date();
  const [division] = await db
    .insert(organizationDivision)
    .values({
      createdAt: now,
      description: input.description?.trim() || null,
      id: randomUUID(),
      name,
      normalizedName: normalizeDivisionKey(name),
      organizationId: input.organizationId,
      position: (positionRow?.value ?? -1) + 1,
      updatedAt: now,
    })
    .returning({ id: organizationDivision.id });

  return { divisionId: division.id };
};

export const updateOrganizationDivision = async (input: {
  description?: string | null;
  divisionId: string;
  name?: string;
  position?: number;
  userId: string;
}) => {
  const division = await getDivisionWithManagerAccess(input);
  const nextName = input.name === undefined ? undefined : normalizeDivisionName(input.name);
  if (nextName !== undefined && !nextName) {
    throw new ORPCError("BAD_REQUEST", { message: "Division name is required." });
  }
  if (nextName !== undefined) {
    await assertDivisionNameAvailable({
      divisionId: input.divisionId,
      name: nextName,
      organizationId: division.organizationId,
    });
  }

  await db
    .update(organizationDivision)
    .set({
      ...(input.description !== undefined
        ? { description: input.description?.trim() || null }
        : {}),
      ...(nextName !== undefined
        ? { name: nextName, normalizedName: normalizeDivisionKey(nextName) }
        : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      updatedAt: new Date(),
    })
    .where(eq(organizationDivision.id, input.divisionId));

  return { divisionId: input.divisionId };
};

export const deleteOrganizationDivision = async (input: { divisionId: string; userId: string }) => {
  await getDivisionWithManagerAccess(input);
  await db.delete(organizationDivision).where(eq(organizationDivision.id, input.divisionId));
  return { deleted: true };
};

export const setOrganizationDivisionMembers = async (input: {
  divisionId: string;
  memberIds: string[];
  userId: string;
}) => {
  const division = await getDivisionWithManagerAccess(input);
  const uniqueMemberIds = Array.from(new Set(input.memberIds));
  if (uniqueMemberIds.length > 0) {
    const validMembers = await db
      .select({ id: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, division.organizationId),
          inArray(member.id, uniqueMemberIds),
        ),
      );
    if (validMembers.length !== uniqueMemberIds.length) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Division members must belong to the same team.",
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(organizationDivisionMember)
      .where(eq(organizationDivisionMember.divisionId, input.divisionId));
    if (uniqueMemberIds.length > 0) {
      await tx.insert(organizationDivisionMember).values(
        uniqueMemberIds.map((memberId) => ({
          createdAt: new Date(),
          divisionId: input.divisionId,
          id: randomUUID(),
          memberId,
        })),
      );
    }
  });

  return { divisionId: input.divisionId };
};
