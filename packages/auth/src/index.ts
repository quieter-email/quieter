import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { getOrganizationBillingEntitlement } from "@quieter/billing/entitlements";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { db } from "@quieter/database/client";
import { tables } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
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
import { GOOGLE_AUTH_SCOPES } from "./google-scopes";
import {
  assertCanDeleteOrganization,
  assertCanLeaveOrganization,
  cleanupMailboxesForDeletedOrganization,
  cleanupOrganizationsForDeletedUser,
  ensureUserOrganizationState,
} from "./organization";
import { ORGANIZATION_API_KEY_CONFIG_ID } from "./organization-api-key";
import { readTermsAcceptedAtFromRequest } from "./terms-acceptance";

const appName = serverEnv.BETTER_AUTH_APP_NAME;
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

const baseURL = serverEnv.BETTER_AUTH_URL || "http://localhost:3000";
const trustedOrigins = [
  baseURL,
  ...(serverEnv.BETTER_AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? []),
];
const organizationApiKeyPlugin = apiKey({
  configId: ORGANIZATION_API_KEY_CONFIG_ID,
  defaultPrefix: "quieter_",
  maximumNameLength: 64,
  references: "organization",
  startingCharactersConfig: {
    charactersLength: 12,
    shouldStore: true,
  },
});

export const auth = betterAuth({
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip"],
    },
  },
  appName,
  baseURL,
  trustedOrigins,
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
        (ctx.path === "/organization/leave" || ctx.path === "/organization/delete") &&
        ctx.body &&
        typeof ctx.body === "object" &&
        "organizationId" in ctx.body &&
        typeof ctx.body.organizationId === "string"
      ) {
        if (ctx.path === "/organization/leave") {
          await assertCanLeaveOrganization(currentSession.user, ctx.body.organizationId);
        } else {
          await assertCanDeleteOrganization(currentSession.user, ctx.body.organizationId);
        }
      }

      if (ctx.path === "/api-key/create") {
        const requirement = BILLING_FEATURES.organizationApiKeys;
        const organizationId =
          ctx.body &&
          typeof ctx.body === "object" &&
          "organizationId" in ctx.body &&
          typeof ctx.body.organizationId === "string"
            ? ctx.body.organizationId
            : null;
        const entitlement = organizationId
          ? await getOrganizationBillingEntitlement({
              feature: "organizationApiKeys",
              organizationId,
            })
          : null;

        if (!entitlement?.hasAccess) {
          throwPlanRequiredError(requirement.requirementLabel, requirement.description);
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
      create: {
        after: async (createdUser) => {
          await ensureUserOrganizationState(createdUser);
        },
        before: async (createdUser, context) => {
          const hasAcceptedTerms = !!readTermsAcceptedAtFromRequest(context?.request);

          if (!hasAcceptedTerms) {
            throw new APIError("BAD_REQUEST", {
              message: "Accept the Terms of Service and Privacy Policy to create an account.",
            });
          }

          return {
            data: {
              ...createdUser,
              termsAcceptedAt: new Date(),
            },
          };
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
    additionalFields: {
      termsAcceptedAt: {
        input: false,
        required: false,
        type: "date",
      },
    },
    changeEmail: {
      enabled: true,
    },
    deleteUser: {
      enabled: true,
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { sendVerificationEmail } = await import("./email");
      await sendVerificationEmail({
        email: user.email,
        url,
      });
    },
  },
  socialProviders: {
    google: {
      clientId: serverEnv.GOOGLE_AUTH_CLIENT_ID ?? "",
      clientSecret: serverEnv.GOOGLE_AUTH_CLIENT_SECRET ?? "",
      disableImplicitSignUp: serverEnv.QUIETER_DEPLOYMENT_ENV !== "preview",
      scope: [...GOOGLE_AUTH_SCOPES],
    },
  },
  plugins: [
    passkey(),
    organization({
      ac: organizationAccessControl,
      hooks: {
        organization: {
          beforeDelete: async ({
            organization: deletedOrganization,
          }: {
            organization: { id: string };
          }) => {
            await cleanupMailboxesForDeletedOrganization(deletedOrganization.id);
          },
        },
      },
      roles: {
        admin: adminRole,
        member: memberRole,
        owner: ownerRole,
      },
    }),
    organizationApiKeyPlugin,
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const { sendMagicLinkEmail } = await import("./email");
        await sendMagicLinkEmail({
          email,
          url,
        });
      },
    }),
    lastLoginMethod(),
    // Must be last so Set-Cookie from other plugins is forwarded on TanStack Start.
    tanstackStartCookies(),
  ] as const,
});
export const organizationApiKeyApi = auth.api as typeof auth.api &
  Pick<typeof organizationApiKeyPlugin.endpoints, "verifyApiKey">;

export { GOOGLE_AUTH_SCOPES };

const throwPlanRequiredError = (plan: string, description: string) => {
  throw new APIError("FORBIDDEN", {
    message: `${description} requires ${plan} billing.`,
  });
};
