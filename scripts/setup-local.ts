import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { diagnoseLocalEnv } from "@quieter/env/local-doctor";

const source = await readFile(".env.local", "utf-8");
const values = parseEnv(source);
const additions: Record<string, string> = {
  GMAIL_LIVE_SYNC_TOKEN_SECRET: randomBytes(32).toString("base64url"),
  GMAIL_LIVE_SYNC_URL: "ws://127.0.0.1:8787/gmail/live",
  QUIETER_LOCAL_GMAIL_WATCH_OWNER: "production",
  QUIETER_LOCAL_PROVIDER_MODE: "observe",
  QUIETER_LOCAL_WORKER_TOKEN: randomBytes(32).toString("base64url"),
};
const missing = Object.entries(additions).filter(
  ([key]) => values[key] === undefined || values[key] === ""
);
const next = `${source.trimEnd()}\n${missing.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`;
const errors = diagnoseLocalEnv(
  new Map(
    Object.entries(parseEnv(next)).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]]
    )
  )
);
if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}
await writeFile(".env.local", next, { mode: 0o600 });
process.stdout.write(
  "Development defaults and unique local Worker secrets are configured.\n"
);
