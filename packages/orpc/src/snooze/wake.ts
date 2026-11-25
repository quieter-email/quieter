import { serverEnv } from "@quieter/env/server";
import { mailSnoozeWakeSchema } from "@quieter/mail/snooze-ticket";
import type { MailSnoozeScope } from "@quieter/mail/snooze-ticket";
import { signMailPayload } from "@quieter/mail/updates";
import { reportError } from "@quieter/observability";

export const requestMailSnoozeWake = async (scope: MailSnoozeScope) => {
  const base = serverEnv.MAIL_UPDATES_URL ?? serverEnv.GMAIL_LIVE_SYNC_URL;
  const secret = serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET;
  if (!base || !secret) {
    return false;
  }
  try {
    const url = new URL(base);
    url.protocol = ["https:", "wss:"].includes(url.protocol)
      ? "https:"
      : "http:";
    url.pathname = "/mail/snooze/wake";
    url.search = "";
    const body = JSON.stringify(
      mailSnoozeWakeSchema.parse({
        ...scope,
        expiresAt: Date.now() + 30_000,
        purpose: "mail-snooze-wake",
      })
    );
    const response = await fetch(url, {
      body,
      headers: {
        "content-type": "application/json",
        "x-mail-signature": await signMailPayload(body, secret),
      },
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error("Snooze scheduler unavailable.");
    }
    return true;
  } catch (error) {
    reportError(error, { operation: "mail-snooze-wake" });
    return false;
  }
};
