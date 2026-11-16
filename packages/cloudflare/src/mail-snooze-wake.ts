import { readMailSnoozeTicket } from "@quieter/mail/snooze-ticket";

import { readLinkedSecret } from "./worker-runtime";

type MailSnoozeWakeEnv = Pick<Env, "SST_RESOURCE_GmailLiveSyncTokenSecret"> & {
  MailSnooze: DurableObjectNamespace;
};

export const handleMailSnoozeWake = async (
  request: Request,
  env: MailSnoozeWakeEnv
) => {
  if (request.method !== "POST") {
    return new Response(null, { headers: { allow: "POST" }, status: 405 });
  }
  const parsed = await readMailSnoozeTicket(
    request,
    readLinkedSecret(env.SST_RESOURCE_GmailLiveSyncTokenSecret),
    "mail-snooze-wake"
  );
  if (!parsed.ok) {
    return new Response(null, { status: parsed.status });
  }
  const { id, mailboxId } = parsed.ticket;
  return await env.MailSnooze.get(
    env.MailSnooze.idFromName(JSON.stringify([mailboxId, id]))
  ).fetch("https://internal/mail-snooze/wake", {
    body: JSON.stringify({ id, mailboxId }),
    method: "POST",
  });
};
