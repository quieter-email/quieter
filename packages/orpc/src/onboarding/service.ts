import { db } from "@quieter/database/client";
import {
  account,
  mailbox,
  mailDomain,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { and, asc, eq } from "drizzle-orm";

import {
  MAILBOX_PROVIDER_GMAIL,
  MAILBOX_PROVIDER_MANAGED,
} from "../mailbox/access";

const GOOGLE_IDENTITY_PROVIDER_ID = "google";

const listUserOrganizations = async (userId: string) =>
  await db
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));

/**
 * Setup state for the onboarding playbooks. Gmail mailboxes are the user's own
 * connections; domains and managed mailboxes live on their first team, which
 * provisioning guarantees to exist.
 */
const getSetupState = async (organizationId: string | null, userId: string) => {
  if (organizationId === null) {
    return {
      domains: [],
      gmailMailboxes: await db
        .select({
          emailAddress: mailbox.emailAddress,
          id: mailbox.id,
        })
        .from(mailbox)
        .where(
          and(
            eq(mailbox.ownerUserId, userId),
            eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL)
          )
        )
        .orderBy(asc(mailbox.createdAt)),
      managedMailboxes: [],
    };
  }

  const [gmailMailboxes, managedMailboxes, domains] = await Promise.all([
    db
      .select({ emailAddress: mailbox.emailAddress, id: mailbox.id })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.ownerUserId, userId),
          eq(mailbox.provider, MAILBOX_PROVIDER_GMAIL)
        )
      )
      .orderBy(asc(mailbox.createdAt)),
    db
      .select({ emailAddress: mailbox.emailAddress, id: mailbox.id })
      .from(mailbox)
      .where(
        and(
          eq(mailbox.organizationId, organizationId),
          eq(mailbox.provider, MAILBOX_PROVIDER_MANAGED)
        )
      )
      .orderBy(asc(mailbox.createdAt)),
    db
      .select({
        domain: mailDomain.domain,
        id: mailDomain.id,
        mode: mailDomain.mode,
        status: mailDomain.status,
      })
      .from(mailDomain)
      .where(eq(mailDomain.organizationId, organizationId))
      .orderBy(asc(mailDomain.createdAt)),
  ]);

  return { domains, gmailMailboxes, managedMailboxes };
};

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

  const [organizations, googleEmail] = await Promise.all([
    listUserOrganizations(userId),
    getGoogleIdentityEmail(userId),
  ]);

  const { domains, gmailMailboxes, managedMailboxes } = await getSetupState(
    organizations[0]?.id ?? null,
    userId
  );

  return {
    domains,
    email: currentUser.email,
    gmailMailboxes,
    googleEmail,
    hasAcceptedTerms:
      currentUser.termsAcceptedAt !== null &&
      currentUser.termsAcceptedAt !== undefined,
    isComplete:
      currentUser.onboardingCompletedAt !== null &&
      currentUser.termsAcceptedAt !== null,
    managedMailboxes,
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

  const [currentUser] = await db
    .select({ termsAcceptedAt: user.termsAcceptedAt })
    .from(user)
    .where(eq(user.id, input.userId))
    .limit(1);

  await db
    .update(user)
    .set({
      name: trimmedName,
      onboardingCompletedAt: now,
      // Keep the earliest acceptance so the audit trail reflects the moment
      // the user first agreed, including accounts stamped at creation time.
      termsAcceptedAt: currentUser?.termsAcceptedAt ?? now,
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
