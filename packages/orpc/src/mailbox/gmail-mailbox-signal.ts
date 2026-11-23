import { serverEnv } from "@quieter/env/server";
import {
  GMAIL_MAILBOX_WAKE_PATH,
  gmailMailboxWakeSchema,
  signMailPayload,
} from "@quieter/mail/updates";
import type { GmailMailboxWake } from "@quieter/mail/updates";
import { reportError } from "@quieter/observability";

export const signalGmailMailbox = async (
  input: Pick<GmailMailboxWake, "kind" | "mailboxId">
) => {
  const base = serverEnv.GMAIL_LIVE_SYNC_URL;
  const secret = serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET;
  if (!base || !secret) {
    if (serverEnv.QUIETER_GMAIL_MAILBOX_LANES === true) {
      reportError(
        new Error("Gmail mailbox wake transport is not configured."),
        { boundary: "gmail-mailbox-wake" }
      );
    }
    return;
  }
  try {
    const url = new URL(GMAIL_MAILBOX_WAKE_PATH, base);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    const body = JSON.stringify(
      gmailMailboxWakeSchema.parse({
        ...input,
        expiresAt: Date.now() + 30_000,
        purpose: "gmail-mailbox-wake",
      })
    );
    const response = await fetch(url, {
      body,
      headers: {
        "content-type": "application/json",
        "x-mail-signature": await signMailPayload(body, secret),
      },
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      throw new Error("Gmail mailbox wake was not accepted.");
    }
  } catch (error) {
    reportError(error, { boundary: "gmail-mailbox-wake" });
  }
};
