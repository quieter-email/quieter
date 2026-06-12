import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL?.trim();

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  tablesFilter: [
    "account",
    "apikey",
    "billingSubscription",
    "chat",
    "chatMessage",
    "chatRun",
    "gmailCredential",
    "gmailLabel",
    "gmailOAuthState",
    "invitation",
    "mailDomain",
    "mailbox",
    "mailboxGrant",
    "managedMailMessage",
    "member",
    "organization",
    "organizationMailUsageAlertEvent",
    "organizationMailUsageEvent",
    "organizationMailUsageSettings",
    "passkey",
    "session",
    "user",
    "verification",
    "waitlistSignup",
  ],
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
  strict: true,
  verbose: true,
});
