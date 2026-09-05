import { assertLocalEnvFile } from "@quieter/env/local-doctor";
import { requireServerEnv } from "@quieter/env/server";

assertLocalEnvFile(".env.local");
const action = process.argv[2] ?? "health";
if (!["health", "maintenance", "actions"].includes(action)) {
  throw new Error("Use dev:trigger health, maintenance, or actions.");
}
const response = await fetch(`http://127.0.0.1:8787/__dev/${action}`, {
  headers: {
    authorization: `Bearer ${requireServerEnv("QUIETER_LOCAL_WORKER_TOKEN")}`,
  },
  method: action === "health" ? "GET" : "POST",
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) {
  throw new Error(
    `Local Worker returned ${response.status}. Check its terminal.`
  );
}
process.stdout.write(`${await response.text()}\n`);
