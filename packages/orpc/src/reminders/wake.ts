import { serverEnv } from "@quieter/env/server";
import { reminderWakeSchema } from "@quieter/mail/reminders";
import { signMailPayload } from "@quieter/mail/updates";
import { reportError } from "@quieter/observability";

export const requestReminderWake = async (input: {
  userId: string;
  mailboxId: string;
}) => {
  const base = serverEnv.MAIL_UPDATES_URL ?? serverEnv.GMAIL_LIVE_SYNC_URL;
  const secret = serverEnv.GMAIL_LIVE_SYNC_TOKEN_SECRET;
  if (!base || !secret) {
    return false;
  }
  try {
    const url = new URL(base);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/mail/reminders/wake";
    url.search = "";
    const body = JSON.stringify(
      reminderWakeSchema.parse({
        expiresAt: Date.now() + 30_000,
        mailboxId: input.mailboxId,
        purpose: "reminder-wake",
        userId: input.userId,
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
      throw new Error("Reminder scheduler unavailable.");
    }
    return true;
  } catch (error) {
    reportError(error, { operation: "reminder-wake" });
    return false;
  }
};
