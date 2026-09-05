import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { S3Client } from "@aws-sdk/client-s3";
import { createDeploymentEnv } from "@quieter/env/deployment";
import { z } from "zod";

import { CloudflareRuntimeProvider } from "./cloudflare.ts";
import { ObjectReleaseJournal } from "./journal.ts";
import { healthyReleaseSchema } from "./schema.ts";

const env = createDeploymentEnv();
if (!env.QUIETER_RELEASE_STAGE.startsWith("release-proof-")) {
  throw new Error(
    "Live failure injection is restricted to isolated release-proof stages."
  );
}
const root = path.resolve(import.meta.dirname, "../../..");
const outputs = z
  .object({
    candidateVersion: z.uuid(),
    phase: z.literal("candidate"),
    scriptName: z.string(),
  })
  .parse(
    JSON.parse(await readFile(path.join(root, ".sst/outputs.json"), "utf-8"))
  );
const recorded = z
  .object({
    id: z.uuid(),
    versions: z
      .array(z.object({ percentage: z.literal(100), version_id: z.uuid() }))
      .length(1),
  })
  .parse(
    JSON.parse(
      await readFile(
        path.join(root, ".scratch/release-proof-baseline-deployment.json"),
        "utf-8"
      )
    )
  );
const provider = new CloudflareRuntimeProvider(
  env.CLOUDFLARE_ACCOUNT_ID,
  env.CLOUDFLARE_API_TOKEN
);
const before = await provider.active(outputs.scriptName);
const journal = new ObjectReleaseJournal(
  new S3Client({ maxAttempts: 1, region: env.AWS_REGION }),
  env.QUIETER_RELEASE_BUCKET,
  env.QUIETER_RELEASE_STAGE
);
let checkpoint = await journal.read();
if (checkpoint === null) {
  assert.equal(
    before.id,
    recorded.id,
    "Inactive upload must preserve the baseline deployment ID."
  );
} else {
  assert.equal(
    checkpoint.state.healthy.services[0].versionId,
    recorded.versions[0].version_id
  );
  if (checkpoint.state.attempt !== null) {
    assert.equal(checkpoint.state.attempt.id, "proof-recovery");
    assert.equal(
      checkpoint.state.attempt.candidate.services[0].versionId,
      outputs.candidateVersion
    );
  }
}
const source = await readFile(
  path.join(import.meta.dirname, "release-probe.ts")
);
const baseline = healthyReleaseSchema.parse({
  id: "proof-baseline",
  services: [
    {
      artifactDigest: createHash("sha256")
        .update(source)
        .update("baseline")
        .digest("hex"),
      bindingGeneration: createHash("sha256")
        .update("proof-bindings-v1")
        .digest("hex"),
      contracts: ["probe_v1"],
      requirements: {},
      scriptName: outputs.scriptName,
      service: "probe",
      versionId: recorded.versions[0].version_id,
    },
  ],
  sourceSha: "0".repeat(40),
});
const candidate = healthyReleaseSchema.parse({
  ...baseline,
  id: "proof-candidate",
  services: baseline.services.map((service) => ({
    ...service,
    artifactDigest: createHash("sha256")
      .update(source)
      .update("candidate")
      .digest("hex"),
    versionId: outputs.candidateVersion,
  })),
});
const baselineFile = path.join(root, ".scratch/release-proof-baseline.json");
const candidateFile = path.join(root, ".scratch/release-proof-candidate.json");
await Promise.all([
  writeFile(baselineFile, JSON.stringify(baseline)),
  writeFile(candidateFile, JSON.stringify(candidate)),
]);
const run = async (args: string[]) => {
  const child = spawn(
    process.execPath,
    [
      "--conditions=development",
      path.join(import.meta.dirname, "cli.ts"),
      ...args,
    ],
    { stdio: "inherit" }
  );
  // oxlint-disable-next-line promise/avoid-new -- Convert child process completion into an awaited result.
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Proof subprocess failed with exit code ${code}.`));
      }
    });
  });
};
if (checkpoint === null) {
  await run(["bootstrap", "--file", baselineFile]);
}
if (checkpoint?.state.attempt === null || checkpoint === null) {
  await run([
    "prepare",
    "--attempt",
    "proof-recovery",
    "--run",
    "1",
    "--file",
    candidateFile,
  ]);
}
checkpoint = await journal.read();
if (
  ["prepared", "promoting"].includes(checkpoint?.state.attempt?.status ?? "")
) {
  await run(["promote", "--attempt", "proof-recovery"]);
  const promoted = await provider.active(outputs.scriptName);
  assert.equal(promoted.versionId, candidate.services[0].versionId);
  assert.notEqual(promoted.id, recorded.id);
}
await run([
  "recover",
  "--attempt",
  "proof-recovery",
  "--reason",
  "process_ended",
]);
const recovered = await provider.active(outputs.scriptName);
assert.equal(recovered.versionId, baseline.services[0].versionId);
checkpoint = await journal.read();
assert.equal(checkpoint?.state.attempt?.status, "rolled_back");
assert.equal(checkpoint?.state.healthy.id, baseline.id);
assert.equal(
  checkpoint?.state.quarantinedArtifacts.includes(
    candidate.services[0].artifactDigest
  ),
  true
);
process.stdout.write(
  "Verified real inactive upload, durable S3 checkpoints, promotion, and recovery from a separate process. Baseline restored.\n"
);
