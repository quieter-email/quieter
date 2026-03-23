import { auth, getSessionWithOrganization } from "@quietr/auth";
import {
  getGoogleScopeRepairTarget as findGoogleScopeRepairTargetForOrganization,
  type GoogleScopeRepairTarget,
} from "@quietr/trpc/mailbox-service";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

const createAuthHeaders = async () => new Headers(await headers());

export const requireSession = cache(async () => {
  const session = await getSessionWithOrganization(await createAuthHeaders());

  if (!session?.user) {
    redirect("/home");
  }

  return session;
});

export const redirectIfAuthenticated = cache(async (href = "/") => {
  const session = await auth.api.getSession({ headers: await createAuthHeaders() });

  if (session?.user) {
    redirect(href);
  }
});

export const getGoogleScopeRepairTarget = async (input?: {
  preferredMailboxId?: string | null;
  targetAccountId?: string | null;
}): Promise<GoogleScopeRepairTarget | null> => {
  const authHeaders = await createAuthHeaders();
  const session = await getSessionWithOrganization(authHeaders);

  if (!session?.user || !session.session?.activeOrganizationId) {
    return null;
  }

  return await findGoogleScopeRepairTargetForOrganization({
    activeOrganizationId: session.session.activeOrganizationId,
    headers: authHeaders,
    preferredMailboxId: input?.preferredMailboxId,
    targetAccountId: input?.targetAccountId,
    userId: session.user.id,
  });
};
