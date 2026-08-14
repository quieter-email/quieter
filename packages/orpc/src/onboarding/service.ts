import { db } from "@quieter/database/client";
import {
  account,
  member,
  mailbox,
  organization,
  user,
} from "@quieter/database/schema";
import { and, asc, eq } from "drizzle-orm";

const GOOGLE_IDENTITY_PROVIDER_ID = "google";

const listUserOrganizations = async (userId: string) =>
  await db
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

/**
 * The address to offer as a one-click Gmail connection.
 *
 * The identity sign-in only holds `openid`/`userinfo` scopes, so its token can
 * never read mail. What it does give us is a verified address, which onboarding
 * passes to Gmail's own consent flow as a `login_hint` so the account picker is
 * skipped. Returns null when the user did not arrive through Google.
 */
const getGoogleIdentityEmail = async (userId: string) => {
  const [linkedAccount] = await db
    .select({ id: account.id })
    .from(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, GOOGLE_IDENTITY_PROVIDER_ID)
      )
    )
    .limit(1);

  if (linkedAccount === undefined) {
    return null;
  }

  const [currentUser] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return currentUser?.email ?? null;
};

export const getOnboardingState = async (userId: string) => {
  const [currentUser] = await db
    .select({
      email: user.email,
      name: user.name,
      onboardingCompletedAt: user.onboardingCompletedAt,
      termsAcceptedAt: user.termsAcceptedAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  if (currentUser === undefined) {
    return null;
  }

  const [organizations, googleEmail, [existingMailbox]] = await Promise.all([
    listUserOrganizations(userId),
    getGoogleIdentityEmail(userId),
    db
      .select({ id: mailbox.id })
      .from(mailbox)
      .where(eq(mailbox.ownerUserId, userId))
      .limit(1),
  ]);

  return {
    email: currentUser.email,
    googleEmail,
    hasMailbox: existingMailbox !== undefined,
    isComplete:
      currentUser.onboardingCompletedAt !== null &&
      currentUser.termsAcceptedAt !== null,
    name: currentUser.name,
    organizationId: organizations[0]?.id ?? null,
    teamName: organizations[0]?.name ?? "",
  };
};

export const completeOnboarding = async (input: {
  name: string;
  teamName?: string;
  userId: string;
}) => {
  const now = new Date();
  const trimmedName = input.name.trim();
  const trimmedTeamName = input.teamName?.trim();

  await db
    .update(user)
    .set({
      name: trimmedName,
      onboardingCompletedAt: now,
      // Recorded here rather than at account creation: this is the moment the
      // user actually accepts, and it survives independently of any cookie.
      termsAcceptedAt: now,
      updatedAt: now,
    })
    .where(eq(user.id, input.userId));

  if (hasText(trimmedTeamName)) {
    const organizations = await listUserOrganizations(input.userId);
    const [defaultOrganization] = organizations;

    if (defaultOrganization !== undefined) {
      // Only the display name changes; the slug stays stable because default
      // team provisioning looks organizations up by it.
      await db
        .update(organization)
        .set({ name: trimmedTeamName, updatedAt: now })
        .where(eq(organization.id, defaultOrganization.id));
    }
  }
};
