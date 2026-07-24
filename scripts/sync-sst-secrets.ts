import { githubSstOptionalSecrets, githubSstSecrets } from "@quieter/env/github";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const stageIndex = process.argv.indexOf("--stage");
const stage = stageIndex === -1 ? undefined : process.argv[stageIndex + 1];

if (!stage) {
  throw new Error("Usage: bun scripts/sync-sst-secrets.ts --stage <stage>");
}

const syncableSecrets = { ...githubSstSecrets, ...githubSstOptionalSecrets };
const configuredSecrets = Object.entries(syncableSecrets).filter(
  ([environmentName]) => process.env[environmentName],
);
const missing = Object.keys(githubSstSecrets).filter((name) => !process.env[name]);

if (stage === "production" && missing.length > 0) {
  throw new Error(`Missing GitHub deployment secrets: ${missing.join(", ")}`);
}
if (configuredSecrets.length === 0) {
  throw new Error("No GitHub deployment secrets were configured.");
}

const secretsFile = join(tmpdir(), `quieter-sst-secrets-${crypto.randomUUID()}.env`);
const contents = configuredSecrets
  .map(([environmentName, sstName]) => `${sstName}=${JSON.stringify(process.env[environmentName])}`)
  .join("\n");

try {
  await Bun.write(secretsFile, `${contents}\n`);
  const processResult = Bun.spawn(
    ["bunx", "sst", "secret", "load", secretsFile, "--config", "sst.config.ts", "--stage", stage],
    { stderr: "inherit", stdout: "inherit" },
  );
  const exitCode = await processResult.exited;

  if (exitCode !== 0) {
    throw new Error(`SST secret synchronization failed with exit code ${exitCode}.`);
  }
} finally {
  await rm(secretsFile, { force: true });
}
