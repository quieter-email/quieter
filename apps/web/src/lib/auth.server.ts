import "@tanstack/react-start/server-only";
import type { RouterOutputs } from "@quieter/orpc";
import { getSessionWithOrganization } from "@quieter/auth";
import { createOrpcServerClient } from "@quieter/orpc/server-client";

export type SessionUser = {
  email: string;
  emailVerified: boolean;
  id: string;
  image: string | null;
  name: string;
};

const mapSessionUser = (user: {
  email: string;
  emailVerified: boolean;
  id: string;
  image?: string | null;
  name: string;
}): SessionUser => ({
  email: user.email,
  emailVerified: user.emailVerified,
  id: user.id,
  image: user.image ?? null,
  name: user.name,
});

const getAuthHeaders = (request: Request) => new Headers(request.headers);

export const getSessionUserForRequest = async (request: Request): Promise<SessionUser | null> => {
  const session = await getSessionWithOrganization(getAuthHeaders(request));

  if (!session?.user) {
    return null;
  }

  return mapSessionUser(session.user);
};

export const getGoogleScopeRepairTargetForRequest = async (
  request: Request,
  input?: {
    preferredMailboxId?: string | null;
    targetAccountId?: string | null;
  },
): Promise<RouterOutputs["mail"]["getGoogleScopeRepairTarget"]> => {
  const authHeaders = getAuthHeaders(request);
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
