import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { S3Client } from "@aws-sdk/client-s3";
import { createDeploymentEnv } from "@quieter/env/deployment";

import { S3ArchiveStore } from "./archive-store.ts";
import { ReleaseArtifactStore } from "./artifact-store.ts";
import { AssetArchive } from "./assets.ts";
import { CloudflareRuntimeProvider } from "./cloudflare.ts";
import { createR2ArchiveClient } from "./r2-archive-client.ts";
import { healthyReleaseSchema } from "./schema.ts";
import { ObjectUploadStore } from "./upload-store.ts";
import { ReleaseUpload } from "./upload.ts";

const env = createDeploymentEnv();
if (
  !env.QUIETER_RELEASE_STAGE.startsWith("release-proof-") ||
  env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID === undefined
) {
  throw new Error(
    "Upload recovery proof requires an isolated controller proof stage and retained artifacts."
  );
}
const directory = path.resolve(
  import.meta.dirname,
  "../../../.scratch",
  `controller-${env.QUIETER_RELEASE_STAGE}`
);
const release = healthyReleaseSchema.parse(
  JSON.parse(await readFile(path.join(directory, "candidate.json"), "utf-8"))
);
assert.equal(release.services.length, 1);
const [service] = release.services;
assert.ok(service.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`));
let lostResponse = false;
const provider = new CloudflareRuntimeProvider(
  env.CLOUDFLARE_ACCOUNT_ID,
  env.CLOUDFLARE_API_TOKEN,
  async (input, init) => {
    const response = await fetch(input, init);
    if (
      init?.method === "POST" &&
      typeof input === "string" &&
      input.endsWith("/versions?deploy=false") &&
      response.ok
    ) {
      await response.arrayBuffer();
      lostResponse = true;
      throw new Error("Injected loss of accepted upload response.");
    }
    return response;
  }
);
const storage = new S3Client({
  maxAttempts: 1,
  region: env.AWS_REGION,
  requestHandler: {
    connectionTimeout: 5000,
    requestTimeout: 15_000,
    throwOnRequestTimeout: true,
  },
});
const bucket = `${env.QUIETER_RELEASE_STAGE}-archive`;
const archiveClient = createR2ArchiveClient({
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  bucket,
  parentAccessKeyId: env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID,
  readOnly: true,
  token: env.CLOUDFLARE_API_TOKEN,
});
try {
  const store = new ObjectUploadStore(
    storage,
    env.QUIETER_RELEASE_BUCKET,
    env.QUIETER_RELEASE_STAGE
  );
  const artifacts = new ReleaseArtifactStore(
    storage,
    env.QUIETER_RELEASE_BUCKET,
    env.QUIETER_RELEASE_STAGE
  );
  const archive = new AssetArchive(new S3ArchiveStore(archiveClient, bucket));
  const uploader = new ReleaseUpload(store, artifacts, archive, provider);
  const intent = {
    artifactDigest: service.artifactDigest,
    baseline: await provider.active(service.scriptName),
    createdAt: new Date().toISOString(),
    id: randomUUID(),
    scriptName: service.scriptName,
    workflowRunId: "0",
  };
  await writeFile(
    path.join(directory, `upload-${intent.id}.json`),
    JSON.stringify(intent)
  );
  await assert.rejects(uploader.upload(intent, directory), /Injected loss/u);
  assert.ok(lostResponse);
  assert.equal(await store.receipt(intent.id), null);
  const child = spawn(
    process.execPath,
    [
      "--conditions=development",
      path.join(import.meta.dirname, "cli.ts"),
      "reconcile-upload",
      "--attempt",
      intent.id,
    ],
    { stdio: "inherit", windowsHide: true }
  );
  // oxlint-disable-next-line promise/avoid-new -- A fresh process must recover using only provider and durable object state.
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("Upload reconciliation process failed."));
      }
    });
  });
  const receipt = await store.receipt(intent.id);
  assert.ok(receipt);
  assert.deepEqual(await uploader.upload(intent, directory), receipt);
  assert.deepEqual(await provider.active(service.scriptName), intent.baseline);
  process.stdout.write(
    "Verified lost upload response recovery in a fresh process, exact provider bytes, one matching version, repeat without re-upload, and unchanged active deployment.\n"
  );
} finally {
  archiveClient.destroy();
  storage.destroy();
}
