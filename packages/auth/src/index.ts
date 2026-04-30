import { passkey } from "@better-auth/passkey";
import { db, tables } from "@quieter/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { magicLink, organization, lastLoginMethod } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { REQUIRED_GOOGLE_SCOPES } from "./google-scopes";
import {
  assertCanLeaveOrganization,
  cleanupOrganizationsForDeletedUser,
  ensureUserOrganizationState,
  getUserById,
} from "./organization";

const appName = process.env.BETTER_AUTH_APP_NAME ?? "quieter";

const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
  "http://localhost:3000";

export const getSessionWithOrganization = async (headers: Headers) => {
  const session = await auth.api.getSession({ headers });

  if (!session?.user || !session.session) {
    return session;
  }

  const currentActiveOrganizationId = session.session.activeOrganizationId ?? null;
  const organizationState = await ensureUserOrganizationState(session.user, {
    activeOrganizationId: currentActiveOrganizationId,
    sessionToken: session.session.token,
  });

  if (organizationState.activeOrganizationId === currentActiveOrganizationId) {
    return session;
  }

  return {
    ...session,
    session: {
      ...session.session,
      activeOrganizationId: organizationState.activeOrganizationId,
    },
  };
};

export const auth = betterAuth({
  appName,
  baseURL,
  trustedOrigins: [baseURL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: tables,
  }),
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/get-session" && !ctx.path.startsWith("/organization")) return;

      const currentSession = await getSessionFromCtx(ctx, {
        disableCookieCache: true,
      }).catch(() => null);

      if (!currentSession?.user || !currentSession.session) return;

      const organizationState = await ensureUserOrganizationState(currentSession.user, {
        activeOrganizationId: currentSession.session.activeOrganizationId ?? null,
        sessionToken: currentSession.session.token,
      });

      if (
        ctx.path === "/organization/leave" &&
        ctx.body &&
        typeof ctx.body === "object" &&
        "organizationId" in ctx.body &&
        typeof ctx.body.organizationId === "string"
      )
        await assertCanLeaveOrganization(currentSession.user, ctx.body.organizationId);

      if (organizationState.activeOrganizationId !== currentSession.session.activeOrganizationId) {
        ctx.context.session = {
          ...currentSession,
          session: {
            ...currentSession.session,
            activeOrganizationId: organizationState.activeOrganizationId,
          },
        };
      }

      if (ctx.path === "/get-session") {
        return {
          context: {
            query: {
              ...ctx.query,
              disableCookieCache: true,
            },
          },
        };
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        before: async (nextSession) => {
          const currentUser = await getUserById(nextSession.userId);

          if (!currentUser)
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not create session because the user record is missing.",
            });

          const organizationState = await ensureUserOrganizationState(currentUser, {
            activeOrganizationId:
              typeof nextSession.activeOrganizationId === "string"
                ? nextSession.activeOrganizationId
                : null,
          });

          return {
            data: {
              ...nextSession,
              activeOrganizationId: organizationState.activeOrganizationId,
            },
          };
        },
      },
    },
    user: {
      create: {
        after: async (createdUser) => {
          await ensureUserOrganizationState(createdUser);
        },
      },
      delete: {
        before: async (deletedUser) => {
          await cleanupOrganizationsForDeletedUser(deletedUser.id);
        },
      },
    },
  },
  account: {
    updateAccountOnSignIn: true,
    accountLinking: {
      allowDifferentEmails: true,
    },
  },
  user: {
    changeEmail: {
      enabled: true,
    },
    deleteUser: {
      enabled: true,
    },
  },
  emailVerification: {
    sendVerificationEmail: async () => {
      // TODO: Wire this to real auth email delivery.
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      accessType: "offline",
      prompt: "consent",
      scope: [...REQUIRED_GOOGLE_SCOPES],
    },
  },
  plugins: [
    passkey(),
    organization({
      organizationHooks: {
        beforeDeleteOrganization: async ({ user }) => {
          await ensureUserOrganizationState(user);
        },
        beforeRemoveMember: async ({ user }) => {
          await ensureUserOrganizationState(user);
        },
      },
    }),
    magicLink({
      sendMagicLink: async () => {
        // TODO: Wire this to real auth email delivery.
      },
    }),
    lastLoginMethod(),
    tanstackStartCookies(),
  ],
});

export { REQUIRED_GOOGLE_SCOPES, ensureUserOrganizationState };
