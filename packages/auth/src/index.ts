import { passkey } from "@better-auth/passkey";
import { db } from "@quietr/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, twoFactor } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start/solid";
import { REQUIRED_GOOGLE_SCOPES } from "./google-scopes";

const appName = process.env.BETTER_AUTH_APP_NAME ?? "Quietr";
const baseURL = process.env.BETTER_AUTH_URL ?? process.env.VERCEL_URL ?? "http://localhost:3000";

export const auth = betterAuth({
  appName,
  baseURL,
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
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
    // magicLink()
    passkey({
      rpID: new URL(baseURL).hostname,
      rpName: appName,
      origin: baseURL,
    }),
    organization({
      teams: {
        enabled: true,
      },
    }),
    twoFactor(),
    tanstackStartCookies(),
  ],
});

export { REQUIRED_GOOGLE_SCOPES };
