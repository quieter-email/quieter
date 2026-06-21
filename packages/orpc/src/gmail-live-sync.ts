import { ORPCError } from "@orpc/server";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db, mailbox } from "@quieter/database";
import { serverEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";
import { createGmailLiveSyncToken } from "./gmail-live-sync-token";

const getLiveSyncConfiguration = () => {
  const secret = serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET;
  const url = serverEnv.GMAIL_LIVE_SYNC_URL;

  if (!secret && !url) {
    return null;
  }
  if (!secret || !url) {
    throw new Error(
      "GMAIL_LIVE_SYNC_TOKEN_SECRET and GMAIL_LIVE_SYNC_URL must be configured together.",
    );
  }
  if (secret.length < 32) {
    throw new Error("GMAIL_LIVE_SYNC_TOKEN_SECRET must contain at least 32 characters.");
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "wss:") {
    throw new Error("GMAIL_LIVE_SYNC_URL must use wss.");
  }

  return { secret, url: parsedUrl };
};

export const getGmailLiveSyncAccess = async (input: { mailboxId: string; userId: string }) => {
  const [selectedMailbox] = await db
    .select({ id: mailbox.id, organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, "gmail"),
        eq(mailbox.status, "connected"),
      ),
    )
    .limit(1);
  if (!selectedMailbox) {
    throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
  }

  return await hasUserBillingFeature({
    feature: "gmailAutomation",
    organizationId: selectedMailbox.organizationId ?? undefined,
    userId: input.userId,
  });
};

export const createGmailLiveSyncConnection = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const access = await getGmailLiveSyncAccess(input);
  const configuration = getLiveSyncConfiguration();
  if (!access.hasAccess || !configuration) {
    return { url: null };
  }

  const { token } = createGmailLiveSyncToken(input, configuration.secret);
  configuration.url.searchParams.set("token", token);

  return { url: configuration.url.toString() };
};
