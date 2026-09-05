import { assertLocalEnvFile } from "@quieter/env/local-doctor";
import { requireServerEnv } from "@quieter/env/server";

assertLocalEnvFile(".env.local");
const [ownerEmail] = process.argv.slice(2);
if (ownerEmail === undefined || !ownerEmail.includes("@")) {
  throw new Error("Use dev:fixtures <email-of-your-local-login>.");
}
const response = await fetch("http://127.0.0.1:8787/__dev/mail/seed", {
  body: JSON.stringify({ ownerEmail }),
  headers: {
    authorization: `Bearer ${requireServerEnv("QUIETER_LOCAL_WORKER_TOKEN")}`,
    "content-type": "application/json",
  },
  method: "POST",
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) {
  throw new Error(
    `Local mail fixtures failed with HTTP ${response.status}. Check the background Worker terminal.`
  );
}
process.stdout.write(`${await response.text()}\n`);
