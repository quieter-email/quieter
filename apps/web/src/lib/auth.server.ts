import "@tanstack/react-start/server-only";
import type { RouterOutputs } from "@quieter/orpc";
import { getSessionWithOrganization } from "@quieter/auth";
import { createOrpcServerClient } from "@quieter/orpc/server-client";

type SessionUser = {
  email: string;
  emailVerified: boolean;
  id: string;
  image: string | null;
  name: string;
};

export const getSessionUserForRequest = async (request: Request): Promise<SessionUser | null> => {
  const session = await getSessionWithOrganization(new Headers(request.headers));

  if (!session?.user) {
    return null;
  }

  return {
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    id: session.user.id,
    image: session.user.image ?? null,
    name: session.user.name,
  };
};

export const getGoogleScopeRepairTargetForRequest = async (
  request: Request,
  input?: {
    preferredMailboxId?: string | null;
    targetAccountId?: string | null;
  },
): Promise<RouterOutputs["mail"]["getGoogleScopeRepairTarget"]> => {
  const authHeaders = new Headers(request.headers);
  const session = await getSessionWithOrganization(authHeaders);

  if (!session?.user || !session.session) {
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
