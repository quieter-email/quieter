import { db, invitation, member, organization, session, user } from "@quieter/database";
import { APIError } from "better-auth/api";
import { eq, inArray } from "drizzle-orm";

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
  const organizationRows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));

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
