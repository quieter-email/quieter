import { db, withRequestDatabaseClient } from "@quieter/database/client";
import { mailbox, tables } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, isNull } from "drizzle-orm";

import { lazyAuth } from "./lazy-auth";
import { ensureUserOrganizationState } from "./organization";

const sessionAuth = lazyAuth(() =>
  betterAuth({
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    baseURL: serverEnv.BETTER_AUTH_URL ?? "http://localhost:3000",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: tables,
    }),
    secret: serverEnv.BETTER_AUTH_SECRET,
    user: {
      additionalFields: {
        defaultOrganizationProvisioned: {
          input: false,
          required: false,
          type: "boolean",
        },
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
    },
  })
);

export const handleSessionRequest = async (request: Request) =>
  await withRequestDatabaseClient(
    async () => await sessionAuth.handler(request)
  );

export const getSessionWithOrganization = async (headers: Headers) =>
  await withRequestDatabaseClient(async () => {
    const session = await sessionAuth.api.getSession({ headers });
    if (!session?.user) {
      return session;
    }
    const orphanedMailboxes =
      session.user.defaultOrganizationProvisioned === true
        ? await db
            .select({ id: mailbox.id })
            .from(mailbox)
            .where(
              and(
                eq(mailbox.ownerUserId, session.user.id),
                eq(mailbox.provider, "gmail"),
                isNull(mailbox.organizationId)
              )
            )
            .limit(1)
        : [];
    if (
      session.user.defaultOrganizationProvisioned !== true ||
      orphanedMailboxes.length > 0
    ) {
      await ensureUserOrganizationState(session.user);
      return {
        ...session,
        user: { ...session.user, defaultOrganizationProvisioned: true },
      };
    }
    return session;
  });
