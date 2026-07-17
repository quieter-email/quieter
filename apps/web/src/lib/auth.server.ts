import "@tanstack/react-start/server-only";
import { getSessionWithOrganization } from "@quieter/auth/session";

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
