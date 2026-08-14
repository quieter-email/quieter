import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { getOrganizationBillingEntitlement } from "@quieter/billing/entitlements";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { db } from "@quieter/database/client";
import { tables } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  createAccessControl,
  magicLink,
  organization,
  lastLoginMethod,
} from "better-auth/plugins";
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

const throwPlanRequiredError = (plan: string, description: string) => {
  throw new APIError("FORBIDDEN", {
    message: `${description} requires ${plan} billing.`,
  });
};

const getOrganizationIdFromBody = (body: unknown) => {
  if (
    body !== null &&
    body !== undefined &&
    typeof body === "object" &&
    "organizationId" in body &&
    typeof body.organizationId === "string"
  ) {
    return body.organizationId;
  }

  return null;
};

const handleOrganizationMembershipGuard = async (
  path: string,
  currentUser: { email: string; id: string; name: string },
  organizationId: string
) => {
  if (path === "/organization/leave") {
    await assertCanLeaveOrganization(currentUser, organizationId);
    return;
  }

  await assertCanDeleteOrganization(currentUser, organizationId);
};

const handleApiKeyCreateGuard = async (body: unknown) => {
  const requirement = BILLING_FEATURES.organizationApiKeys;
  const organizationId = getOrganizationIdFromBody(body);
  const entitlement =
    organizationId === null || organizationId === undefined
      ? null
      : await getOrganizationBillingEntitlement({
          feature: "organizationApiKeys",
          organizationId,
        });

  if (entitlement?.hasAccess !== true) {
    throwPlanRequiredError(
      requirement.requirementLabel,
      requirement.description
    );
  }
};

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

const baseURL = serverEnv.BETTER_AUTH_URL ?? "http://localhost:3000";
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
  account: {
    updateAccountOnSignIn: true,
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: ["cf-connecting-ip"],
    },
  },
  appName,
  baseURL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: tables,
  }),
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          await ensureUserOrganizationState(createdUser);
        },
        /**
         * Acceptance is recorded during onboarding, not at account creation,
         * so the account may exist before it. The onboarding gate keeps the
         * product unusable until `termsAcceptedAt` is set, and a stale
         * acceptance cookie from a previous flow still counts.
         */
        before: async (createdUser, context) =>
          await Promise.resolve({
            data: {
              ...createdUser,
              termsAcceptedAt:
                readTermsAcceptedAtFromRequest(context?.request) ?? null,
            },
          }),
      },
      delete: {
        before: async (deletedUser) => {
          await cleanupOrganizationsForDeletedUser(deletedUser.id);
        },
      },
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
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const requiresSession =
        ctx.path === "/get-session" ||
        ctx.path.startsWith("/organization") ||
        ctx.path === "/api-key/create";

      if (!requiresSession) {
        return;
      }

      const currentSession = await getSessionFromCtx(ctx, {
        disableCookieCache: true,
      }).catch(() => null);

      if (
        currentSession?.user === null ||
        currentSession?.user === undefined ||
        currentSession.session === null ||
        currentSession.session === undefined
      ) {
        return;
      }

      const organizationId = getOrganizationIdFromBody(ctx.body);
      if (
        (ctx.path === "/organization/leave" ||
          ctx.path === "/organization/delete") &&
        organizationId !== null &&
        organizationId !== undefined
      ) {
        await handleOrganizationMembershipGuard(
          ctx.path,
          currentSession.user,
          organizationId
        );
      }

      if (ctx.path === "/api-key/create") {
        await handleApiKeyCreateGuard(ctx.body);
      }

      if (ctx.path === "/get-session") {
        Object.assign(ctx, {
          query: {
            ...ctx.query,
            disableCookieCache: true,
          },
        });
      }
    }),
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
            await cleanupMailboxesForDeletedOrganization(
              deletedOrganization.id
            );
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
  socialProviders: {
    google: {
      clientId: serverEnv.GOOGLE_AUTH_CLIENT_ID ?? "",
      clientSecret: serverEnv.GOOGLE_AUTH_CLIENT_SECRET ?? "",
      disableImplicitSignUp: true,
      scope: [...GOOGLE_AUTH_SCOPES],
    },
  },
  trustedOrigins,
  user: {
    additionalFields: {
      onboardingCompletedAt: {
        input: false,
        required: false,
        type: "date",
      },
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
});
const organizationApiKeyApi: typeof auth.api &
  Pick<typeof organizationApiKeyPlugin.endpoints, "verifyApiKey"> = {
  ...auth.api,
  verifyApiKey: organizationApiKeyPlugin.endpoints.verifyApiKey,
};
export { organizationApiKeyApi };

export { GOOGLE_AUTH_SCOPES } from "./google-scopes";
