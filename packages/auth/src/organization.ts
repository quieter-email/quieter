import { db, invitation, member, organization, session, user } from "@quietr/database";
import { APIError } from "better-auth/api";
import { and, eq, inArray, or } from "drizzle-orm";

type AuthUser = typeof user.$inferSelect;

type UserIdentity = Pick<AuthUser, "email" | "id" | "name">;

type EnsureUserOrganizationStateOptions = {
  activeOrganizationId?: string | null;
  sessionToken?: string;
};

type EnsureUserOrganizationStateResult = {
  activeOrganizationId: string;
  organizationIds: string[];
  personalOrganizationId: string;
};

const slugifyOrganizationValue = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const buildPersonalOrganizationName = (currentUser: UserIdentity) => {
  const baseName = currentUser.name.trim() || currentUser.email.trim() || "Personal";

  return `${baseName}'s Personal`;
};

const buildLegacyPersonalOrganizationSlug = (userId: string) => `personal-${userId}`;

const buildPersonalOrganizationSlug = (currentUser: UserIdentity) => {
  const emailHandle = currentUser.email.split("@")[0] ?? "";
  const readableBase =
    slugifyOrganizationValue(currentUser.name) ||
    slugifyOrganizationValue(emailHandle) ||
    "personal";
  const normalizedUserId = slugifyOrganizationValue(currentUser.id) || currentUser.id.toLowerCase();

  return `${readableBase}-personal-${normalizedUserId}`;
};

const getPersonalOrganization = async (userId: string) => {
  const personalSlug = buildLegacyPersonalOrganizationSlug(userId);
  const [personalOrganization] = await db
    .select()
    .from(organization)
    .where(or(eq(organization.personalOwnerUserId, userId), eq(organization.slug, personalSlug)))
    .limit(1);

  return personalOrganization ?? null;
};

const getUserOrganizationIds = async (userId: string) => {
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));

  return rows.map((row) => row.organizationId);
};

const ensurePersonalMembership = async (organizationId: string, userId: string) => {
  const [existingMembership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);

  if (existingMembership) {
    return;
  }

  try {
    await db.insert(member).values({
      createdAt: new Date(),
      id: crypto.randomUUID(),
      organizationId,
      role: "owner",
      userId,
    });
  } catch (error) {
    const [membershipAfterInsert] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1);

    if (!membershipAfterInsert) {
      throw error;
    }
  }
};

const ensurePersonalOrganization = async (currentUser: UserIdentity) => {
  let personalOrganization = await getPersonalOrganization(currentUser.id);
  const nextPersonalName = buildPersonalOrganizationName(currentUser);
  const legacyPersonalSlug = buildLegacyPersonalOrganizationSlug(currentUser.id);
  const personalSlug = buildPersonalOrganizationSlug(currentUser);
  const now = new Date();

  if (!personalOrganization) {
    try {
      const [createdOrganization] = await db
        .insert(organization)
        .values({
          createdAt: now,
          id: crypto.randomUUID(),
          metadata: null,
          name: nextPersonalName,
          personalOwnerUserId: currentUser.id,
          slug: personalSlug,
          updatedAt: now,
        })
        .returning();

      personalOrganization = createdOrganization ?? null;
    } catch (error) {
      personalOrganization = await getPersonalOrganization(currentUser.id);

      if (!personalOrganization) {
        throw error;
      }
    }
  }

  if (!personalOrganization) {
    throw new Error("Could not create a personal organization.");
  }

  const shouldUpgradeLegacySlug = personalOrganization.slug === legacyPersonalSlug;

  if (personalOrganization.personalOwnerUserId !== currentUser.id || shouldUpgradeLegacySlug) {
    try {
      const [updatedOrganization] = await db
        .update(organization)
        .set({
          personalOwnerUserId: currentUser.id,
          slug: shouldUpgradeLegacySlug ? personalSlug : personalOrganization.slug,
          updatedAt: now,
        })
        .where(eq(organization.id, personalOrganization.id))
        .returning();

      personalOrganization = updatedOrganization ?? personalOrganization;
    } catch (error) {
      if (personalOrganization.personalOwnerUserId !== currentUser.id) {
        throw error;
      }
    }
  }

  await ensurePersonalMembership(personalOrganization.id, currentUser.id);

  return personalOrganization;
};

export const ensureUserOrganizationState = async (
  currentUser: UserIdentity,
  options: EnsureUserOrganizationStateOptions = {},
): Promise<EnsureUserOrganizationStateResult> => {
  const personalOrganization = await ensurePersonalOrganization(currentUser);
  const organizationIds = await getUserOrganizationIds(currentUser.id);
  const activeOrganizationId =
    options.activeOrganizationId && organizationIds.includes(options.activeOrganizationId)
      ? options.activeOrganizationId
      : personalOrganization.id;

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
    personalOrganizationId: personalOrganization.id,
  };
};

export const ensureUsersHavePersonalOrganizations = async (userIds: string[]) => {
  const uniqueUserIds = [...new Set(userIds)];

  if (uniqueUserIds.length === 0) {
    return;
  }

  const users = await db
    .select({
      email: user.email,
      id: user.id,
      name: user.name,
    })
    .from(user)
    .where(inArray(user.id, uniqueUserIds));

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
  const personalOrganization = await getPersonalOrganization(userId);

  if (personalOrganization) {
    const personalOrganizationMembers = await db
      .select({ userId: member.userId })
      .from(member)
      .where(eq(member.organizationId, personalOrganization.id));

    await ensureUsersHavePersonalOrganizations(
      personalOrganizationMembers
        .map((personalOrganizationMember) => personalOrganizationMember.userId)
        .filter((memberUserId) => memberUserId !== userId),
    );

    await db.delete(invitation).where(eq(invitation.organizationId, personalOrganization.id));
    await db.delete(member).where(eq(member.organizationId, personalOrganization.id));
    await db.delete(organization).where(eq(organization.id, personalOrganization.id));
  }

  await db.delete(invitation).where(eq(invitation.inviterId, userId));
  await db.delete(member).where(eq(member.userId, userId));
};

export const assertCanLeaveOrganization = async (
  currentUser: UserIdentity,
  organizationId: string,
) => {
  const organizationState = await ensureUserOrganizationState(currentUser);

  if (organizationId === organizationState.personalOrganizationId) {
    throw new APIError("BAD_REQUEST", {
      message: "You can't leave your personal organization.",
    });
  }

  if (organizationState.organizationIds.length <= 1) {
    throw new APIError("BAD_REQUEST", {
      message: "You must keep at least one organization.",
    });
  }
};
