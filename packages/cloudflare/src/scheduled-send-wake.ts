import { readScheduledSendTicket } from "@quieter/mail/scheduled-send-ticket";

import { readLinkedSecret } from "./worker-runtime";

export const handleScheduledSendWake = async (request: Request, env: Env) => {
  if (request.method !== "POST") {
    return new Response(null, { headers: { allow: "POST" }, status: 405 });
  }
  const parsed = await readScheduledSendTicket(
    request,
    readLinkedSecret(env.SST_RESOURCE_GmailLiveSyncTokenSecret),
    "scheduled-send-wake"
  );
  if (!parsed.ok) {
    return new Response(null, { status: parsed.status });
  }
  const { id, mailboxId, userId } = parsed.ticket;
  return await env.ScheduledSend.get(
    env.ScheduledSend.idFromName(JSON.stringify([userId, mailboxId, id]))
  ).fetch("https://internal/scheduled-send/wake", {
    body: JSON.stringify({ id, mailboxId, userId }),
    method: "POST",
  });
};
