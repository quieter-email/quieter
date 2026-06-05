import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { BILLING_FEATURES, type PaidBillingPlan } from "@quieter/billing/plans";
import { db, tables } from "@quieter/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { createAccessControl, magicLink, organization, lastLoginMethod } from "better-auth/plugins";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { sendMagicLinkEmail, sendVerificationEmail } from "./email";
import { REQUIRED_GOOGLE_SCOPES } from "./google-scopes";
import { assertCanLeaveOrganization, cleanupOrganizationsForDeletedUser } from "./organization";

const appName = process.env.BETTER_AUTH_APP_NAME ?? "quieter";
const teamApiKeyConfigId = "team";
const organizationAccessControl = createAccessControl({
  ...defaultStatements,
  apiKey: ["create", "read", "update", "delete"],
});
const ownerRole = organizationAccessControl.newRole({
  ...ownerAc.statements,
  apiKey: ["create", "read", "update", "delete"],
});
const adminRole = organizationAccessControl.newRole({
  ...adminAc.statements,
  apiKey: ["create", "read", "update", "delete"],
});
const memberRole = organizationAccessControl.newRole({
  ...memberAc.statements,
  apiKey: ["read"],
});

const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
  "http://localhost:3000";

export const getSessionWithOrganization = async (headers: Headers) => {
  return await auth.api.getSession({ headers });
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
      const requiresSession =
        ctx.path === "/get-session" ||
        ctx.path.startsWith("/organization") ||
        ctx.path === "/api-key/create";

      if (!requiresSession) return;

      const currentSession = await getSessionFromCtx(ctx, {
        disableCookieCache: true,
      }).catch(() => null);

      if (!currentSession?.user || !currentSession.session) return;

      if (
        ctx.path === "/organization/leave" &&
        ctx.body &&
        typeof ctx.body === "object" &&
        "organizationId" in ctx.body &&
        typeof ctx.body.organizationId === "string"
      )
        await assertCanLeaveOrganization(currentSession.user, ctx.body.organizationId);

      if (ctx.path === "/api-key/create") {
        const requirement = BILLING_FEATURES.teamApiKeys;
        const entitlement = await hasUserBillingFeature({
          feature: "teamApiKeys",
          userId: currentSession.user.id,
        });

        if (!entitlement.hasAccess) {
          throwPlanRequiredError(requirement.requiredPlan, requirement.description);
        }
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
    user: {
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
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({
        email: user.email,
        url,
      });
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      accessType: "offline",
      scope: [...REQUIRED_GOOGLE_SCOPES],
    },
  },
  plugins: [
    passkey(),
    organization({
      ac: organizationAccessControl,
      roles: {
        admin: adminRole,
        member: memberRole,
        owner: ownerRole,
      },
    }),
    apiKey({
      configId: teamApiKeyConfigId,
      defaultPrefix: "quieter_",
      references: "organization",
    }),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail({
          email,
          url,
        });
      },
    }),
    lastLoginMethod(),
    tanstackStartCookies(),
  ],
});

export { REQUIRED_GOOGLE_SCOPES };

const throwPlanRequiredError = (plan: PaidBillingPlan, description: string) => {
  throw new APIError("FORBIDDEN", {
    message: `${description} requires the ${plan} plan.`,
  });
};
