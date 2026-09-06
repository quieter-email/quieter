import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createDeploymentEnv } from "@quieter/env/deployment";
import { z } from "zod";

import { inventoryWorkerArtifact } from "./artifact.ts";
import { CloudflareRuntimeProvider } from "./cloudflare.ts";

const env = createDeploymentEnv();
if (
  !env.QUIETER_RELEASE_STAGE.startsWith("release-proof-") ||
  env.QUIETER_RELEASE_PROBE_TOKEN === undefined
) {
  throw new Error(
    "Native upload proof requires an isolated stage and its linked probe token."
  );
}
const root = path.resolve(import.meta.dirname, "../../..");
const outputs = z
  .object({ scriptName: z.string(), url: z.url() })
  .parse(
    JSON.parse(await readFile(path.join(root, ".sst/outputs.json"), "utf-8"))
  );
if (
  !outputs.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`) ||
  new URL(outputs.url).protocol !== "https:" ||
  !new URL(outputs.url).hostname.endsWith(".workers.dev")
) {
  throw new Error("Proof outputs do not identify an isolated Worker.");
}
const provider = new CloudflareRuntimeProvider(
  env.CLOUDFLARE_ACCOUNT_ID,
  env.CLOUDFLARE_API_TOKEN
);
const before = await provider.active(outputs.scriptName);
const directory = path.join(root, ".scratch/native-upload-proof");
await Promise.all([
  mkdir(path.join(directory, "server"), { recursive: true }),
  mkdir(path.join(directory, "client"), { recursive: true }),
]);
await cp(
  path.join(root, "packages/deployment/fixtures/client"),
  path.join(directory, "client"),
  { recursive: true }
);
await writeFile(
  path.join(directory, "client/assets/probe-abcdef34.js"),
  'export const releaseProbe = "candidate";\n'
);
const baseline = await fetch(outputs.url, {
  headers: { authorization: `Bearer ${env.QUIETER_RELEASE_PROBE_TOKEN}` },
  redirect: "error",
  signal: AbortSignal.timeout(5000),
});
assert.equal(baseline.status, 200);
assert.deepEqual(await baseline.json(), { generation: "baseline" });
await Promise.all([
  writeFile(
    path.join(directory, "server/index.js"),
    await readFile(
      path.join(
        root,
        ".sst/artifacts/Probe-src/packages/deployment/src/release-probe.ts"
      )
    )
  ),
  writeFile(
    path.join(directory, "server/wrangler.json"),
    JSON.stringify({
      assets: { run_worker_first: true },
      compatibility_date: "2026-08-04",
      compatibility_flags: ["nodejs_compat"],
    })
  ),
]);
const { artifact } = await inventoryWorkerArtifact(
  directory,
  "native-upload-proof",
  "0".repeat(40)
);
const receipt = await provider.uploadArtifact(
  outputs.scriptName,
  before.versionId,
  artifact,
  directory
);
await writeFile(
  path.join(root, ".scratch/native-upload-receipt.json"),
  JSON.stringify(receipt)
);
assert.deepEqual(await provider.active(outputs.scriptName), before);
const preview = new URL(outputs.url);
preview.hostname = `${receipt.versionId.slice(0, 8)}-${preview.hostname}`;
const denied = await fetch(preview, {
  redirect: "error",
  signal: AbortSignal.timeout(5000),
});
assert.equal(denied.status, 404);
const candidate = await fetch(preview, {
  headers: { authorization: `Bearer ${env.QUIETER_RELEASE_PROBE_TOKEN}` },
  redirect: "error",
  signal: AbortSignal.timeout(5000),
});
assert.equal(candidate.status, 200);
assert.deepEqual(await candidate.json(), { generation: "baseline" });
const assetUrl = new URL("/assets/probe-abcdef34.js", preview);
const deniedAsset = await fetch(assetUrl, {
  redirect: "error",
  signal: AbortSignal.timeout(5000),
});
assert.equal(deniedAsset.status, 404);
const asset = await fetch(assetUrl, {
  headers: { authorization: `Bearer ${env.QUIETER_RELEASE_PROBE_TOKEN}` },
  redirect: "error",
  signal: AbortSignal.timeout(5000),
});
assert.equal(asset.status, 200);
assert.equal(await asset.text(), 'export const releaseProbe = "candidate";\n');
assert.equal(asset.headers.get("x-release-proof"), "immutable-asset");
process.stdout.write(
  "Verified native code/assets upload, exact baseline binding inheritance, protected candidate code and assets, routing headers, and unchanged active deployment.\n"
);
