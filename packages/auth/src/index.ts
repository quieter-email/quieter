import { passkey } from "@better-auth/passkey";
import { db, member } from "@quietr/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink, organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { storeAuthEmailPreview } from "./email-placeholder";
import { REQUIRED_GOOGLE_SCOPES } from "./google-scopes";
import {
  assertCanLeaveOrganization,
  cleanupOrganizationsForDeletedUser,
  ensureUserOrganizationState,
  ensureUsersHavePersonalOrganizations,
  getUserById,
} from "./organization";

const appName = process.env.BETTER_AUTH_APP_NAME ?? "Quietr";

const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
  "http://localhost:3000";

const isOrganizationRepairPath = (path: string) =>
  path === "/get-session" || path.startsWith("/organization");

export const auth = betterAuth({
  appName,
  baseURL,
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!isOrganizationRepairPath(ctx.path)) {
        return;
      }

      const currentSession = await getSessionFromCtx(ctx, {
        disableCookieCache: true,
      }).catch(() => null);

      if (!currentSession?.user || !currentSession.session) {
        return;
      }

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
      ) {
        await assertCanLeaveOrganization(currentSession.user, ctx.body.organizationId);
      }

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

          if (!currentUser) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Could not create session because the user record is missing.",
            });
          }

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
    sendVerificationEmail: async ({ token, url, user }) => {
      storeAuthEmailPreview({
        email: user.email,
        token,
        type: "verification",
        url,
      });
      console.info(`[quietr auth placeholder] verification for ${user.email}: ${url}`);
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
    nextCookies(),
    passkey(),
    organization({
      organizationHooks: {
        beforeDeleteOrganization: async ({ organization, user }) => {
          if (organization.personalOwnerUserId) {
            throw new APIError("BAD_REQUEST", {
              message: "Personal organizations can't be deleted.",
            });
          }

          const organizationMembers = await db
            .select({ userId: member.userId })
            .from(member)
            .where(eq(member.organizationId, organization.id));

          await ensureUsersHavePersonalOrganizations(
            organizationMembers.map((organizationMember) => organizationMember.userId),
          );

          await ensureUserOrganizationState(user);
        },
        beforeRemoveMember: async ({ organization, user }) => {
          await ensureUserOrganizationState(user);

          if (organization.personalOwnerUserId === user.id) {
            throw new APIError("BAD_REQUEST", {
              message: "You can't leave your personal organization.",
            });
          }
        },
      },
      schema: {
        organization: {
          additionalFields: {
            personalOwnerUserId: {
              required: false,
              type: "string",
            },
          },
        },
      },
    }),
    magicLink({
      sendMagicLink: async ({ email, token, url }) => {
        storeAuthEmailPreview({
          email,
          token,
          type: "magic-link",
          url,
        });
        console.info(`[quietr auth placeholder] magic link for ${email}: ${url}`);
      },
    }),
  ],
});

export { REQUIRED_GOOGLE_SCOPES };
