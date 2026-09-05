import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { diagnoseLocalEnv } from "@quieter/env/local-doctor";
import { sstSecretNames } from "@quieter/env/sst-secrets";
import { Resource } from "sst";

if (!/^local-[a-z0-9-]+$/u.test(Resource.App.stage)) {
  throw new Error("Linked development secrets require a personal local stage.");
}
const values = parseEnv(await readFile(".env.local", "utf-8"));
const mapping = {
  ...sstSecretNames,
  QUIETER_LOCAL_WORKER_TOKEN: "LocalWorkerToken",
};
let count = 0;
for (const [key, name] of Object.entries(mapping)) {
  if (values[key] === undefined || values[key] === "") {
    continue;
  }
  const resource: unknown = Reflect.get(Resource, name);
  if (
    typeof resource !== "object" ||
    resource === null ||
    !("value" in resource) ||
    typeof resource.value !== "string"
  ) {
    throw new Error(`Missing development secret link: ${name}.`);
  }
  values[key] = resource.value;
  count += 1;
}
const checked = new Map(
  Object.entries(values).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
);
const failures = diagnoseLocalEnv(checked);
if (failures.length > 0) {
  throw new Error(failures.join("\n"));
}
await writeFile(
  ".env.local",
  `${[...checked].map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n")}\n`,
  { mode: 0o600 }
);
process.stdout.write(
  `Refreshed ${count} linked development secrets in ignored local configuration.\n`
);
