import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { diagnoseLocalEnv } from "@quieter/env/local-doctor";
import { sstSecretNames } from "@quieter/env/sst-secrets";

const [action, stage] = process.argv.slice(2);
if (
  (action !== "push" && action !== "pull") ||
  stage === undefined ||
  !/^local-[a-z0-9-]+$/u.test(stage)
) {
  throw new Error(
    "Use secrets:dev push|pull local-<name>. Production and fallback secret stores are excluded."
  );
}
const mapping = {
  ...sstSecretNames,
  DATABASE_MIGRATION_URL: "DevDatabaseMigrationUrl",
  QUIETER_LOCAL_WORKER_TOKEN: "LocalWorkerToken",
};
const source = await readFile(".env.local", "utf-8");
const current = parseEnv(source);
const errors = diagnoseLocalEnv(
  new Map(
    Object.entries(current).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]]
    )
  )
);
if (action === "push" && errors.length > 0) {
  throw new Error(errors.join("\n"));
}
if (action === "push") {
  const secrets = Object.entries(mapping).flatMap(([key, name]) => {
    const value = current[key];
    return value === undefined || value === ""
      ? []
      : [`${name}=${JSON.stringify(value)}`];
  });
  await mkdir(".scratch", { recursive: true });
  const file = `.scratch/local-secrets-${randomUUID()}.env`;
  await writeFile(file, secrets.join("\n"), { mode: 0o600 });
  try {
    const result = spawnSync(
      process.execPath,
      [
        "node_modules/sst/bin/sst.mjs",
        "secret",
        "load",
        file,
        "--stage",
        stage,
      ],
      { encoding: "utf-8", windowsHide: true }
    );
    if (result.status !== 0) {
      throw new Error(
        "SST secret import failed. Check AWS login and the development stage. Output suppressed to protect secret values."
      );
    }
    process.stdout.write(
      `Stored ${secrets.length} development secrets in ${stage}.\n`
    );
  } finally {
    await unlink(file);
  }
} else {
  const result = spawnSync(
    process.execPath,
    ["node_modules/sst/bin/sst.mjs", "secret", "list", "--stage", stage],
    { encoding: "utf-8", windowsHide: true }
  );
  if (result.status !== 0 || !result.stdout.includes(`# quieter/${stage}`)) {
    throw new Error("Could not read the requested development secret store.");
  }
  const secrets = parseEnv(result.stdout);
  if (
    secrets.DatabaseUrl === undefined ||
    secrets.DevDatabaseMigrationUrl === undefined
  ) {
    throw new Error(
      "The development secret store must contain its own app and migration database URLs."
    );
  }
  const merged = { ...current };
  let count = 0;
  for (const [key, name] of Object.entries(mapping)) {
    if (secrets[name] !== undefined) {
      merged[key] = secrets[name];
      count += 1;
    }
  }
  const checked = new Map(
    Object.entries(merged).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]]
    )
  );
  const failures = diagnoseLocalEnv(checked);
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
  await writeFile(
    ".env.local",
    `${[...checked]
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n")}\n`,
    { mode: 0o600 }
  );
  process.stdout.write(
    `Loaded ${count} development secrets from ${stage} into ignored local configuration. Run dev:prepare and restart development.\n`
  );
}
