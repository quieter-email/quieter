import { passkey } from "@better-auth/passkey";
import { db } from "@quietr/database";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { storeAuthEmailPreview } from "./email-placeholder";
import { REQUIRED_GOOGLE_SCOPES } from "./google-scopes";

const appName = process.env.BETTER_AUTH_APP_NAME ?? "Quietr";
const vercelBaseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
  : undefined;
const baseURL = process.env.BETTER_AUTH_URL ?? vercelBaseUrl ?? "http://localhost:3000";

export const auth = betterAuth({
  appName,
  baseURL,
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
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
