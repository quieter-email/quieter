import { db, invitation, member, organization, session, user } from "@quieter/database";
import { APIError } from "better-auth/api";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

type AuthUser = typeof user.$inferSelect;

type UserIdentity = Pick<AuthUser, "email" | "id" | "name">;

type EnsureUserOrganizationStateOptions = {
  activeOrganizationId?: string | null;
  sessionToken?: string;
};

type EnsureUserOrganizationStateResult = {
  activeOrganizationId: string | null;
  organizationIds: string[];
};

const getUserOrganizationIds = async (userId: string) => {
  const rows = await db
    .select({
      organizationId: member.organizationId,
      personalOwnerUserId: organization.personalOwnerUserId,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), isNotNull(organization.personalOwnerUserId)));

  if (rows.length > 0) {
    const legacyOrganizationIds = rows.map((row) => row.organizationId);
    const ownedLegacyOrganizationIds = rows
      .filter((row) => row.personalOwnerUserId === userId)
      .map((row) => row.organizationId);

    await db.delete(member).where(inArray(member.organizationId, legacyOrganizationIds));

    if (ownedLegacyOrganizationIds.length > 0) {
      await db
        .delete(invitation)
        .where(inArray(invitation.organizationId, ownedLegacyOrganizationIds));
      await db.delete(member).where(inArray(member.organizationId, ownedLegacyOrganizationIds));
      await db.delete(organization).where(inArray(organization.id, ownedLegacyOrganizationIds));
    }
  }

  const organizationRows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(and(eq(member.userId, userId), isNull(organization.personalOwnerUserId)));

  return organizationRows.map((row) => row.organizationId);
};

export const ensureUserOrganizationState = async (
  currentUser: UserIdentity,
  options: EnsureUserOrganizationStateOptions = {},
): Promise<EnsureUserOrganizationStateResult> => {
  const organizationIds = await getUserOrganizationIds(currentUser.id);
  const activeOrganizationId =
    options.activeOrganizationId && organizationIds.includes(options.activeOrganizationId)
      ? options.activeOrganizationId
      : null;

  if (options.sessionToken && activeOrganizationId !== options.activeOrganizationId) {
    await db
      .update(session)
      .set({
        activeOrganizationId,
        updatedAt: new Date(),
      })
      .where(eq(session.token, options.sessionToken));
  }

  return {
    activeOrganizationId,
    organizationIds,
  };
};

export const ensureUsersHavePersonalOrganizations = async (userIds: string[]) => {
  if (userIds.length === 0) {
    return;
  }

  const users = await db
    .select({
      email: user.email,
      id: user.id,
      name: user.name,
    })
    .from(user)
    .where(inArray(user.id, [...new Set(userIds)]));

  await Promise.all(users.map((currentUser) => ensureUserOrganizationState(currentUser)));
};

export const getUserById = async (userId: string) => {
  const [currentUser] = await db
    .select({
      email: user.email,
      id: user.id,
      name: user.name,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return currentUser ?? null;
};

export const cleanupOrganizationsForDeletedUser = async (userId: string) => {
  const legacyOrganizations = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.personalOwnerUserId, userId));
  const legacyOrganizationIds = legacyOrganizations.map(
    (legacyOrganization) => legacyOrganization.id,
  );

  if (legacyOrganizationIds.length > 0) {
    await db.delete(invitation).where(inArray(invitation.organizationId, legacyOrganizationIds));
    await db.delete(member).where(inArray(member.organizationId, legacyOrganizationIds));
    await db.delete(organization).where(inArray(organization.id, legacyOrganizationIds));
  }

  await db.delete(invitation).where(eq(invitation.inviterId, userId));
  await db.delete(member).where(eq(member.userId, userId));
};

export const assertCanLeaveOrganization = async (
  currentUser: UserIdentity,
  organizationId: string,
) => {
  const organizationState = await ensureUserOrganizationState(currentUser);

  if (!organizationState.organizationIds.includes(organizationId)) {
    throw new APIError("BAD_REQUEST", {
      message: "You are not a member of that organization.",
    });
  }
};
