/* oxlint-disable eslint/no-await-in-loop -- Pull, handoff and acknowledgement must stay ordered. */
import { execFile } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

import { assertLocalEnvFile } from "@quieter/env/local-doctor";
import { requireServerEnv, serverEnv } from "@quieter/env/server";

assertLocalEnvFile(".env.local");
if (serverEnv.QUIETER_DEPLOYMENT_ENV !== "local") {
  throw new Error(
    "The local subscription bridge requires development configuration."
  );
}
const subscription = requireServerEnv("GMAIL_PUBSUB_SUBSCRIPTION");
if (
  !/^projects\/[^/]+\/subscriptions\/quieter-gmail-local-[a-z0-9-]+$/u.test(
    subscription
  )
) {
  throw new Error(
    "Refusing to consume a subscription outside the development namespace."
  );
}
const localToken = requireServerEnv("QUIETER_LOCAL_WORKER_TOKEN");
// oxlint-disable-next-line typescript/strict-void-return -- Node provides a custom promisify implementation for execFile.
const run = promisify(execFile);
let accessToken = "";
let refreshAfter = 0;
const stop = new AbortController();
process.once("SIGINT", () => {
  stop.abort();
});
process.once("SIGTERM", () => {
  stop.abort();
});
process.stdout.write(
  "Consuming the development subscription. Provider writes follow the local profile.\n"
);

while (!stop.signal.aborted) {
  try {
    if (Date.now() >= refreshAfter) {
      const command =
        process.platform === "win32" ? "powershell.exe" : "gcloud";
      const args =
        process.platform === "win32"
          ? ["-NoProfile", "-Command", "gcloud auth print-access-token --quiet"]
          : ["auth", "print-access-token", "--quiet"];
      const result = await run(command, args, {
        timeout: 30_000,
        windowsHide: true,
      });
      accessToken = result.stdout.trim();
      refreshAfter = Date.now() + 45 * 60_000;
    }
    const response = await fetch(
      `https://pubsub.googleapis.com/v1/${subscription}:pull`,
      {
        body: JSON.stringify({ maxMessages: 1 }),
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.any([stop.signal, AbortSignal.timeout(60_000)]),
      }
    );
    if (!response.ok) {
      if (response.status === 401) {
        refreshAfter = 0;
      }
      throw new Error(`Pub/Sub pull returned ${response.status}.`);
    }
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("receivedMessages" in body)
    ) {
      await setTimeout(1000, undefined, { signal: stop.signal });
      continue;
    }
    if (!Array.isArray(body.receivedMessages)) {
      throw new TypeError("Invalid Pub/Sub response.");
    }
    const deliveries: unknown[] = body.receivedMessages;
    for (const delivery of deliveries) {
      if (
        typeof delivery !== "object" ||
        delivery === null ||
        !("ackId" in delivery) ||
        typeof delivery.ackId !== "string" ||
        !("message" in delivery)
      ) {
        throw new Error("Invalid Pub/Sub delivery.");
      }
      const accepted = await fetch("http://127.0.0.1:8787/__dev/pubsub", {
        body: JSON.stringify({ message: delivery.message, subscription }),
        headers: {
          authorization: `Bearer ${localToken}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.any([stop.signal, AbortSignal.timeout(15_000)]),
      });
      if (!accepted.ok) {
        throw new Error(
          `Local queue handoff returned ${accepted.status}; delivery was not acknowledged.`
        );
      }
      const ack = await fetch(
        `https://pubsub.googleapis.com/v1/${subscription}:acknowledge`,
        {
          body: JSON.stringify({ ackIds: [delivery.ackId] }),
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.any([stop.signal, AbortSignal.timeout(15_000)]),
        }
      );
      if (!ack.ok) {
        throw new Error(`Pub/Sub acknowledgement returned ${ack.status}.`);
      }
      process.stdout.write(
        "Notification stored in the local queue and acknowledged.\n"
      );
    }
  } catch (error) {
    if (stop.signal.aborted) {
      break;
    }
    process.stderr.write(
      `${error instanceof Error ? error.message : "Subscription bridge failed."}\n`
    );
    try {
      await setTimeout(5000, undefined, { signal: stop.signal });
    } catch (delayError) {
      if (!stop.signal.aborted) {
        throw delayError;
      }
    }
  }
}
