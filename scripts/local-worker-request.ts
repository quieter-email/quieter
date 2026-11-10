import { assertLocalEnvFile } from "@quieter/env/local-doctor";
import { requireServerEnv, serverEnv } from "@quieter/env/server";

assertLocalEnvFile(".env.local");
const action = process.argv[2] ?? "health";
if (
  ![
    "health",
    "maintenance",
    "mail-recovery",
    "importance",
    "memory",
    "semantic-index",
    "actions",
    "reminders",
    "scheduled-send",
  ].includes(action)
) {
  throw new Error(
    "Use dev:trigger health, maintenance, mail-recovery, importance, memory, semantic-index <user-id> <mailbox-id> <memory|chat|mail>, actions, reminders, or scheduled-send."
  );
}
const workerOrigin = new URL(
  serverEnv.MAIL_UPDATES_URL ?? "ws://127.0.0.1:8787/mail/live"
).origin.replace(/^ws/u, "http");
const response = await fetch(`${workerOrigin}/__dev/${action}`, {
  ...(action === "semantic-index"
    ? {
        body: JSON.stringify({
          kind: process.argv[5],
          mailboxId: process.argv[4],
          userId: process.argv[3],
        }),
      }
    : {}),
  ...(action === "memory"
    ? { body: JSON.stringify({ userId: process.argv[3] }) }
    : {}),
  headers: {
    authorization: `Bearer ${requireServerEnv("QUIETER_LOCAL_WORKER_TOKEN")}`,
  },
  method: action === "health" ? "GET" : "POST",
  signal: AbortSignal.timeout(
    ["importance", "memory", "actions", "semantic-index", "reminders"].includes(
      action
    )
      ? 180_000
      : 30_000
  ),
});
if (!response.ok) {
  throw new Error(
    `Local Worker returned ${response.status}. Check its terminal.`
  );
}
process.stdout.write(`${await response.text()}\n`);
