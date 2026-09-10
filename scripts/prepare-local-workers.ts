import { writeFile } from "node:fs/promises";

import { assertLocalEnvFile, parseEnvFile } from "@quieter/env/local-doctor";
import { serverEnv } from "@quieter/env/server";

assertLocalEnvFile(".env.local");
const values = parseEnvFile(".env.local");
if (
  !values.has("QUIETER_LOCAL_WORKER_TOKEN") ||
  !values.has("GMAIL_LIVE_SYNC_TOKEN_SECRET")
) {
  throw new Error("Local Worker secrets are missing. Run dev:setup first.");
}
const allowed = new Set([
  ...Object.keys(serverEnv),
  "VITE_LOGO_DEV_PUBLISHABLE_KEY",
]);
allowed.delete("DATABASE_MIGRATION_URL");
const bindings = Object.fromEntries(
  [...values].filter(([key]) => allowed.has(key))
);
bindings.NODE_ENV = "development";
bindings.SST_RESOURCE_GmailLiveSyncTokenSecret = JSON.stringify({
  value: values.get("GMAIL_LIVE_SYNC_TOKEN_SECRET"),
});
await writeFile(
  ".dev.vars",
  `${Object.entries(bindings)
    .map(([key, value]) => {
      const quote = ["'", "`"].find((candidate) => !value.includes(candidate));
      if (quote === undefined) {
        throw new Error(`Cannot serialize ${key} into a local Worker binding.`);
      }
      return `${key}=${quote}${value}${quote}`;
    })
    .join("\n")}\n`,
  { mode: 0o600 }
);
process.stdout.write(
  "Prepared ignored local Worker bindings. Migration credentials are excluded.\n"
);
