import type { RouterOutputs } from "@quietr/orpc";
import { auth, getSessionWithOrganization } from "@quietr/auth";
import { createOrpcServerClient } from "@quietr/orpc/server-client";
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
}): Promise<RouterOutputs["mail"]["getGoogleScopeRepairTarget"]> => {
  const authHeaders = await createAuthHeaders();
  const session = await getSessionWithOrganization(authHeaders);

  if (!session?.user || !session.session?.activeOrganizationId) {
    return null;
  }

  const client = createOrpcServerClient({
    headers: authHeaders,
  });

  return await client.mail.getGoogleScopeRepairTarget({
    preferredMailboxId: input?.preferredMailboxId ?? null,
    targetAccountId: input?.targetAccountId ?? null,
  });
};
