import { assertLocalEnvFile } from "@quieter/env/local-doctor";
import { requireServerEnv } from "@quieter/env/server";

assertLocalEnvFile(".env.local");
const action = process.argv[2] ?? "health";
if (!["health", "maintenance", "mail-recovery", "briefs"].includes(action)) {
  throw new Error(
    "Use dev:trigger health, maintenance, mail-recovery, or briefs."
  );
}
const response = await fetch(`http://127.0.0.1:8787/__dev/${action}`, {
  headers: {
    authorization: `Bearer ${requireServerEnv("QUIETER_LOCAL_WORKER_TOKEN")}`,
  },
  method: action === "health" ? "GET" : "POST",
  signal: AbortSignal.timeout(action === "briefs" ? 180_000 : 30_000),
});
if (!response.ok) {
  throw new Error(
    `Local Worker returned ${response.status}. Check its terminal.`
  );
}
process.stdout.write(`${await response.text()}\n`);
