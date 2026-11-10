import { serverEnv } from "@quieter/env/server";
import { scheduledSendWakeSchema } from "@quieter/mail/scheduled-send-ticket";
import type { ScheduledSendScope } from "@quieter/mail/scheduled-send-ticket";
import { signMailPayload } from "@quieter/mail/updates";
import { reportError } from "@quieter/observability";

export const requestScheduledSendWake = async (scope: ScheduledSendScope) => {
  const base = serverEnv.MAIL_UPDATES_URL ?? serverEnv.GMAIL_LIVE_SYNC_URL;
  const secret = serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET;
  if (!base || !secret) {
    return false;
  }
  try {
    const url = new URL(base);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/mail/scheduled-send/wake";
    url.search = "";
    const body = JSON.stringify(
      scheduledSendWakeSchema.parse({
        ...scope,
        expiresAt: Date.now() + 30_000,
        purpose: "scheduled-send-wake",
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
      throw new Error("Scheduled sender unavailable.");
    }
    return true;
  } catch (error) {
    reportError(error, { operation: "scheduled-send-wake" });
    return false;
  }
};
