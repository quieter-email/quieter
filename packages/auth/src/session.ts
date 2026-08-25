import { db } from "@quieter/database/client";
import { tables } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins/bearer";

import { ensureUserOrganizationState } from "./organization";

const sessionAuth = betterAuth({
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
  plugins: [bearer()],
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
  },
});

export const handleSessionRequest = async (request: Request) =>
  await sessionAuth.handler(request);

export const getSessionWithOrganization = async (headers: Headers) => {
  const session = await sessionAuth.api.getSession({ headers });
  if (session?.user) {
    await ensureUserOrganizationState(session.user);
  }
  return session;
};
