import { Resource } from "sst";
import { z } from "zod";

import {
  mailUpdateSchema,
  signMailPayload,
} from "../packages/mail/src/updates.ts";

try {
  const origin = z.url().parse(process.argv[2]);
  const resource: unknown = Reflect.get(Resource, "GmailLiveSyncTokenSecret");
  const { value: secret } = z
    .object({ value: z.string().min(1) })
    .parse(resource);
  const event = mailUpdateSchema.parse({
    eventId: crypto.randomUUID(),
    mailboxId: `deployment-check-${crypto.randomUUID()}`,
    type: "mailbox.changed",
  });
  const body = JSON.stringify({
    event,
    expiresAt: Date.now() + 20_000,
    purpose: "mail-event",
  });
  const response = await fetch(new URL("/mail/events", origin), {
    body,
    headers: {
      "content-type": "application/json",
      "x-mail-signature": await signMailPayload(body, secret),
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  await response.arrayBuffer();
  if (response.status === 204) {
    process.stdout.write(
      "Verified signed mail event delivery and recipient lookup.\n"
    );
  } else {
    process.stderr.write(
      `Mail updates check failed (HTTP ${response.status}).\n`
    );
    process.exitCode = 1;
  }
} catch {
  process.stderr.write("Mail updates check failed.\n");
  process.exitCode = 1;
}
