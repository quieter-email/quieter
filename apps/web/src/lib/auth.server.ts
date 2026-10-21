import "@tanstack/react-start/server-only";
import type { SessionUser } from "@quieter/app/session-user";
import { getSessionWithOrganization } from "@quieter/auth/session";

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
