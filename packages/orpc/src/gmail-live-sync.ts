import { ORPCError } from "@orpc/server";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { db } from "@quieter/database/client";
import { mailbox } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, eq } from "drizzle-orm";

import { createGmailLiveSyncToken } from "./gmail-live-sync-token";
import { hasText } from "./text";

const getLiveSyncConfiguration = () => {
  const secret = serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET;
  const url = serverEnv.GMAIL_LIVE_SYNC_URL;
  const hasSecret = hasText(secret);
  const hasUrl = hasText(url);

  if (!hasSecret && !hasUrl) {
    return null;
  }
  if (!hasSecret || !hasUrl) {
    throw new Error(
      "GMAIL_LIVE_SYNC_TOKEN_SECRET and GMAIL_LIVE_SYNC_URL must be configured together."
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "GMAIL_LIVE_SYNC_TOKEN_SECRET must contain at least 32 characters."
    );
  }

  const parsedUrl = new URL(url);
  const localWebSocket =
    serverEnv.QUIETER_DEPLOYMENT_ENV === "local" &&
    parsedUrl.protocol === "ws:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== "wss:" && !localWebSocket) {
    throw new Error("GMAIL_LIVE_SYNC_URL must use wss.");
  }

  return { secret, url: parsedUrl };
};

export const getGmailLiveSyncAccess = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const [selectedMailbox] = await db
    .select({
      emailAddress: mailbox.emailAddress,
      id: mailbox.id,
      organizationId: mailbox.organizationId,
    })
    .from(mailbox)
    .where(
      and(
        eq(mailbox.id, input.mailboxId),
        eq(mailbox.ownerUserId, input.userId),
        eq(mailbox.provider, "gmail"),
        eq(mailbox.status, "connected")
      )
    )
    .limit(1);
  if (selectedMailbox === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Gmail mailbox not found." });
  }

  const entitlement = await hasUserBillingFeature({
    feature: "gmailAutomation",
    organizationId: selectedMailbox.organizationId ?? undefined,
    userId: input.userId,
  });
  return {
    ...entitlement,
    emailAddress: selectedMailbox.emailAddress,
  };
};

export const createGmailLiveSyncConnection = async (input: {
  mailboxId: string;
  userId: string;
}) => {
  const access = await getGmailLiveSyncAccess(input);
  const configuration = getLiveSyncConfiguration();
  if (!access.hasAccess || configuration === null) {
    return { url: null };
  }

  const { token } = createGmailLiveSyncToken(
    { ...input, emailAddress: access.emailAddress },
    configuration.secret
  );
  configuration.url.searchParams.set("token", token);

  return { url: configuration.url.toString() };
};
