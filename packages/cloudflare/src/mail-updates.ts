import { withRequestDatabaseClient } from "@quieter/database/client";
import {
  mailConnectionSchema,
  mailUpdateSchema,
  verifyMailPayload,
} from "@quieter/mail/updates";
import type { MailUpdate } from "@quieter/mail/updates";
import {
  findGmailUpdateMailboxIds,
  listMailUpdateRecipients,
} from "@quieter/orpc/mail-updates";
import { z } from "zod";

import { readBoundedJson } from "./bounded-json";
import { readLinkedSecret } from "./worker-runtime";

export const broadcastMailUpdate = async (env: Env, event: MailUpdate) => {
  const recipients = await withRequestDatabaseClient(
    async () => await listMailUpdateRecipients(event.mailboxId)
  );
  // Bounded fan-out also limits pressure from large shared mailboxes.
  for (let offset = 0; offset < recipients.length; offset += 10) {
    await Promise.all(
      recipients.slice(offset, offset + 10).map(async (userId) => {
        const stub = env.MailLiveUser.get(env.MailLiveUser.idFromName(userId));
        const response = await stub.fetch("https://internal/mail/events", {
          body: JSON.stringify(event),
          method: "POST",
        });
        if (!response.ok) {
          throw new Error("Mail broadcast failed.");
        }
      })
    );
  }
};

export const handleMailUpdates = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const secret = readLinkedSecret(env.SST_RESOURCE_GmailLiveSyncTokenSecret);
  if (url.pathname === "/mail/live") {
    const ticket = url.searchParams.get("ticket") ?? "";
    if (
      !(await verifyMailPayload(
        ticket,
        url.searchParams.get("signature") ?? "",
        secret
      ))
    ) {
      return new Response(null, { status: 401 });
    }
    const payload = mailConnectionSchema.parse(JSON.parse(ticket));
    if (payload.expiresAt <= Date.now()) {
      return new Response(null, { status: 401 });
    }
    return await env.MailLiveUser.get(
      env.MailLiveUser.idFromName(payload.userId)
    ).fetch(request);
  }
  if (url.pathname !== "/mail/events" || request.method !== "POST") {
    return new Response(null, { status: 404 });
  }
  // Verify the exact bytes without accepting an unbounded request body.
  const value: unknown = await readBoundedJson(request, 16_384);
  const body = JSON.stringify(value);
  if (
    !(await verifyMailPayload(
      body,
      request.headers.get("x-mail-signature") ?? "",
      secret
    ))
  ) {
    return new Response(null, { status: 401 });
  }
  const payload = z
    .object({
      event: mailUpdateSchema,
      expiresAt: z.number(),
      purpose: z.literal("mail-event"),
    })
    .parse(value);
  if (
    payload.expiresAt <= Date.now() ||
    payload.expiresAt > Date.now() + 30_000
  ) {
    return new Response(null, { status: 401 });
  }
  await broadcastMailUpdate(env, payload.event);
  return new Response(null, { status: 204 });
};

export const broadcastGmailUpdate = async (
  env: Env,
  emailAddress: string,
  type: MailUpdate["type"]
) => {
  const mailboxes = await withRequestDatabaseClient(
    async () => await findGmailUpdateMailboxIds(emailAddress)
  );
  for (const box of mailboxes) {
    await broadcastMailUpdate(env, {
      eventId: crypto.randomUUID(),
      mailboxId: box.id,
      type,
    });
  }
};
