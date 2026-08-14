import "@tanstack/react-start/server-only";
import { getSessionWithOrganization } from "@quieter/auth/session";

type SessionUser = {
  email: string;
  emailVerified: boolean;
  id: string;
  image: string | null;
  name: string;
  needsOnboarding: boolean;
};

export const getSessionUserForRequest = async (
  request: Request
): Promise<SessionUser | null> => {
  const session = await getSessionWithOrganization(
    new Headers(request.headers)
  );

  if (!session?.user) {
    return null;
  }

  return {
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    id: session.user.id,
    image: session.user.image ?? null,
    name: session.user.name,
    // Terms are accepted during onboarding, so an account can exist before
    // consent. Every authenticated route redirects until this clears.
    needsOnboarding:
      session.user.termsAcceptedAt === null ||
      session.user.termsAcceptedAt === undefined ||
      session.user.onboardingCompletedAt === null ||
      session.user.onboardingCompletedAt === undefined,
  };
};
