import { Resource } from "sst";
import { z } from "zod";

import {
  mailDispatchProbePath,
  mailDispatchProbeSchema,
} from "../packages/mail/src/dispatch.ts";
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
  const probe = process.argv.includes("--dispatch");
  const expiresAt = Date.now() + 20_000;
  const body = JSON.stringify(
    probe
      ? mailDispatchProbeSchema.parse({
          expiresAt,
          purpose: "mail-dispatch-probe",
        })
      : { event, expiresAt, purpose: "mail-event" }
  );
  const response = await fetch(
    new URL(probe ? mailDispatchProbePath : "/mail/events", origin),
    {
      body,
      headers: {
        "content-type": "application/json",
        "x-mail-signature": await signMailPayload(body, secret),
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    }
  );
  await response.arrayBuffer();
  if (response.status === 204) {
    process.stdout.write(
      probe
        ? "Verified hosted database notices and signed mail dispatch.\n"
        : "Verified signed mail event delivery and recipient lookup.\n"
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
