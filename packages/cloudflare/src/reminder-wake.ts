import { reminderWakeSchema } from "@quieter/mail/reminders";
import { verifyMailPayload } from "@quieter/mail/updates";

import { readBoundedJson } from "./bounded-json";
import { readLinkedSecret } from "./worker-runtime";

export const handleReminderWake = async (request: Request, env: Env) => {
  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }
  const value: unknown = await readBoundedJson(request, 4096);
  const body = JSON.stringify(value);
  const secret = readLinkedSecret(env.SST_RESOURCE_GmailLiveSyncTokenSecret);
  if (
    !(await verifyMailPayload(
      body,
      request.headers.get("x-mail-signature") ?? "",
      secret
    ))
  ) {
    return new Response(null, { status: 401 });
  }
  const payload = reminderWakeSchema.safeParse(value);
  if (
    !payload.success ||
    payload.data.expiresAt <= Date.now() ||
    payload.data.expiresAt > Date.now() + 30_000
  ) {
    return new Response(null, { status: 401 });
  }
  const { mailboxId, userId } = payload.data;
  return await env.ReminderMailbox.get(
    env.ReminderMailbox.idFromName(JSON.stringify([userId, mailboxId]))
  ).fetch("https://internal/reminders/wake", {
    body: JSON.stringify({ mailboxId, userId }),
    method: "POST",
  });
};
