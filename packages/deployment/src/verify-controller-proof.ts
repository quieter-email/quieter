import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { S3Client } from "@aws-sdk/client-s3";
import { createDeploymentEnv } from "@quieter/env/deployment";
import { z } from "zod";

import { S3ArchiveStore } from "./archive-store.ts";
import { ReleaseArtifactStore } from "./artifact-store.ts";
import { inventoryWorkerArtifact, releaseArtifactSchema } from "./artifact.ts";
import { AssetArchive, inventoryAssets } from "./assets.ts";
import { CloudflareRuntimeProvider } from "./cloudflare.ts";
import { ObjectReleaseJournal } from "./journal.ts";
import { createR2ArchiveClient } from "./r2-archive-client.ts";
import { healthyReleaseSchema } from "./schema.ts";

const env = createDeploymentEnv();
if (
  !env.QUIETER_RELEASE_STAGE.startsWith("release-proof-") ||
  env.QUIETER_RELEASE_PROBE_TOKEN === undefined ||
  env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID === undefined
) {
  throw new Error(
    "Controller proof requires an isolated stage with linked probe and archive access."
  );
}
const root = path.resolve(import.meta.dirname, "../../..");
const outputs = z
  .object({
    archive: z.string(),
    journal: z.string(),
    phase: z.literal("baseline"),
    scriptName: z.string(),
    url: z.url(),
  })
  .parse(
    JSON.parse(await readFile(path.join(root, ".sst/outputs.json"), "utf-8"))
  );
if (
  !outputs.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`) ||
  outputs.archive !== `${env.QUIETER_RELEASE_STAGE}-archive` ||
  outputs.journal !== env.QUIETER_RELEASE_BUCKET ||
  !new URL(outputs.url).hostname.endsWith(".workers.dev")
) {
  throw new Error("Proof outputs do not match the isolated stage.");
}
const storage = new S3Client({
  maxAttempts: 1,
  region: env.AWS_REGION,
  requestHandler: {
    connectionTimeout: 5000,
    requestTimeout: 15_000,
    throwOnRequestTimeout: true,
  },
});
const journal = new ObjectReleaseJournal(
  storage,
  env.QUIETER_RELEASE_BUCKET,
  env.QUIETER_RELEASE_STAGE
);
if ((await journal.read()) !== null) {
  throw new Error(
    "This drill requires a new proof journal. Inspect and resume existing attempts through the release CLI; never erase them to rerun a drill."
  );
}
const provider = new CloudflareRuntimeProvider(
  env.CLOUDFLARE_ACCOUNT_ID,
  env.CLOUDFLARE_API_TOKEN
);
const baselineDeployment = await provider.active(outputs.scriptName);
const archiveClient = createR2ArchiveClient({
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  bucket: outputs.archive,
  parentAccessKeyId: env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID,
  readOnly: false,
  token: env.CLOUDFLARE_API_TOKEN,
});
const archive = new AssetArchive(
  new S3ArchiveStore(archiveClient, outputs.archive)
);
const artifacts = new ReleaseArtifactStore(
  storage,
  env.QUIETER_RELEASE_BUCKET,
  env.QUIETER_RELEASE_STAGE
);
const directory = path.join(
  root,
  ".scratch",
  `controller-${env.QUIETER_RELEASE_STAGE}`
);
const run = async (args: string[]) => {
  const child = spawn(
    process.execPath,
    [
      "--conditions=development",
      path.join(import.meta.dirname, "cli.ts"),
      ...args,
    ],
    { stdio: "inherit", windowsHide: true }
  );
  // oxlint-disable-next-line promise/avoid-new -- Await a separate release process so the drill cannot rely on in-memory controller state.
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Release proof command ${args[0]} failed. Read its durable journal before resuming.`
          )
        );
      }
    });
  });
};
try {
  await mkdir(path.join(directory, "server"), { recursive: true });
  await cp(
    path.join(root, "packages/deployment/fixtures/client"),
    path.join(directory, "client"),
    { recursive: true }
  );
  await writeFile(
    path.join(directory, "server/index.js"),
    await readFile(
      path.join(
        root,
        ".sst/artifacts/Probe-src/packages/deployment/src/release-probe.ts"
      )
    )
  );
  await writeFile(
    path.join(directory, "server/wrangler.json"),
    JSON.stringify({
      assets: { run_worker_first: true },
      compatibility_date: "2026-08-04",
      compatibility_flags: ["nodejs_compat"],
    })
  );
  const baselineArtifact = await inventoryWorkerArtifact(
    directory,
    `${env.QUIETER_RELEASE_STAGE}-baseline`,
    "0".repeat(40)
  );
  const baselineArchive = await inventoryAssets(
    path.join(directory, "client"),
    baselineArtifact.artifact.buildId,
    baselineArtifact.digest
  );
  await archive.upload(path.join(directory, "client"), baselineArchive);
  await artifacts.write(
    releaseArtifactSchema.parse({
      ...baselineArtifact,
      archive: baselineArchive,
    })
  );
  const baseline = healthyReleaseSchema.parse({
    id: "proof-baseline",
    services: [
      {
        artifactDigest: baselineArtifact.digest,
        bindingGeneration: createHash("sha256")
          .update(baselineDeployment.versionId)
          .digest("hex"),
        contracts: ["probe_v1"],
        requirements: {},
        scriptName: outputs.scriptName,
        service: "probe",
        versionId: baselineDeployment.versionId,
      },
    ],
    sourceSha: "0".repeat(40),
  });
  const publicHealth = new URL("/__release/health", outputs.url);
  const baselineHealth = new URL(publicHealth);
  baselineHealth.hostname = `${baselineDeployment.versionId.slice(0, 8)}-${baselineHealth.hostname}`;
  const baselineFile = path.join(directory, "baseline.json");
  const probesFile = path.join(directory, "probes.json");
  const probes = {
    probe: {
      baselineUrl: baselineHealth.href,
      candidateUrl: baselineHealth.href,
      checks: ["ready", "assets"],
      url: publicHealth.href,
    },
  };
  await writeFile(baselineFile, JSON.stringify(baseline));
  await writeFile(probesFile, JSON.stringify(probes));
  await run(["bootstrap", "--file", baselineFile, "--probes", probesFile]);
  process.stdout.write("Verified and recorded live baseline.\n");

  await writeFile(
    path.join(directory, "client/assets/probe-abcdef34.js"),
    'export const releaseProbe = "candidate";\n'
  );
  const candidateArtifact = await inventoryWorkerArtifact(
    directory,
    `${env.QUIETER_RELEASE_STAGE}-candidate`,
    "0".repeat(40)
  );
  const candidateArchive = await inventoryAssets(
    path.join(directory, "client"),
    candidateArtifact.artifact.buildId,
    candidateArtifact.digest
  );
  await archive.upload(path.join(directory, "client"), candidateArchive);
  await artifacts.write(
    releaseArtifactSchema.parse({
      ...candidateArtifact,
      archive: candidateArchive,
    })
  );
  const receipt = await provider.uploadArtifact(
    outputs.scriptName,
    baselineDeployment.versionId,
    candidateArtifact.artifact,
    directory
  );
  assert.deepEqual(
    await provider.active(outputs.scriptName),
    baselineDeployment
  );
  const candidate = healthyReleaseSchema.parse({
    ...baseline,
    id: "proof-candidate",
    services: baseline.services.map((service) => ({
      ...service,
      artifactDigest: receipt.artifactDigest,
      versionId: receipt.versionId,
    })),
  });
  const candidateFile = path.join(directory, "candidate.json");
  await writeFile(candidateFile, JSON.stringify(candidate));
  const candidateHealth = new URL(publicHealth);
  candidateHealth.hostname = `${receipt.versionId.slice(0, 8)}-${candidateHealth.hostname}`;
  probes.probe.candidateUrl = candidateHealth.href;
  await writeFile(probesFile, JSON.stringify(probes));
  const denied = await fetch(candidateHealth, {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(denied.status, 404);
  await denied.body?.cancel();
  await run([
    "prepare",
    "--attempt",
    "proof-promote",
    "--run",
    "1",
    "--file",
    candidateFile,
    "--probes",
    probesFile,
  ]);
  await run(["promote", "--attempt", "proof-promote"]);
  await run(["observe", "--attempt", "proof-promote"]);
  const certified = await journal.read();
  assert.equal(certified?.state.healthy.id, candidate.id);
  process.stdout.write(
    "Certified candidate after real two-minute health observation.\n"
  );

  probes.probe.candidateUrl = baselineHealth.href;
  probes.probe.baselineUrl = candidateHealth.href;
  await writeFile(probesFile, JSON.stringify(probes));
  await run([
    "prepare",
    "--rollback",
    "--attempt",
    "proof-rollback",
    "--run",
    "2",
    "--file",
    baselineFile,
    "--probes",
    probesFile,
  ]);
  await run(["promote", "--attempt", "proof-rollback"]);
  await run(["observe", "--attempt", "proof-rollback"]);
  const rolledBack = await journal.read();
  assert.equal(rolledBack?.state.healthy.id, baseline.id);
  process.stdout.write(
    "Certified explicit rollback to the retained baseline.\n"
  );

  probes.probe.candidateUrl = candidateHealth.href;
  probes.probe.baselineUrl = baselineHealth.href;
  await writeFile(probesFile, JSON.stringify(probes));
  await run([
    "prepare",
    "--attempt",
    "proof-runner-ended",
    "--run",
    "3",
    "--file",
    candidateFile,
    "--probes",
    probesFile,
  ]);
  await run(["promote", "--attempt", "proof-runner-ended"]);
  await run([
    "recover",
    "--attempt",
    "proof-runner-ended",
    "--reason",
    "writer_ended",
  ]);
  const recovered = await journal.read();
  assert.equal(recovered?.state.attempt?.status, "rolled_back");
  const restored = await provider.active(outputs.scriptName);
  assert.equal(restored.versionId, baselineDeployment.versionId);
  assert.ok(
    recovered?.state.quarantinedArtifacts.includes(candidateArtifact.digest)
  );
  process.stdout.write(
    "Verified separate-process compensation, restored health, and quarantine after the promoting process ended before certification.\n"
  );
} finally {
  archiveClient.destroy();
  storage.destroy();
}
