import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { createDeploymentEnv } from "@quieter/env/deployment";
import { z } from "zod";

import { S3ArchiveStore } from "./archive-store.ts";
import {
  inventoryWorkerArtifact,
  readArtifactFile,
  releaseArtifactSchema,
} from "./artifact.ts";
import { AssetArchive, inventoryAssets } from "./assets.ts";
import { CloudflareRuntimeProvider } from "./cloudflare.ts";
import { createR2ArchiveClient } from "./r2-archive-client.ts";
import { verifyWebCandidate } from "./web-proof.ts";

const { values } = parseArgs({
  options: { directory: { type: "string" }, manifest: { type: "string" } },
});
const env = createDeploymentEnv();
if (
  !env.QUIETER_RELEASE_STAGE.startsWith("release-proof-") ||
  env.QUIETER_RELEASE_PROBE_TOKEN === undefined ||
  env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID === undefined ||
  values.directory === undefined ||
  values.manifest === undefined
) {
  throw new Error(
    "The web proof requires an isolated linked stage and the exact --directory and --manifest from the tested web build."
  );
}
const original = releaseArtifactSchema.parse(
  JSON.parse(await readFile(values.manifest, "utf-8"))
);
const root = path.resolve(import.meta.dirname, "../../..");
const outputs = z
  .object({ archive: z.string(), webScriptName: z.string(), webUrl: z.url() })
  .parse(
    JSON.parse(await readFile(path.join(root, ".sst/outputs.json"), "utf-8"))
  );
if (
  !outputs.webScriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`) ||
  outputs.archive !== `${env.QUIETER_RELEASE_STAGE}-archive` ||
  !new URL(outputs.webUrl).hostname.endsWith(".workers.dev")
) {
  throw new Error("Web proof outputs do not identify this isolated stage.");
}
const directory = path.join(root, ".scratch/web-proofs", randomUUID());
await mkdir(path.join(directory, "server"), { recursive: true });
await mkdir(path.join(directory, "client"), { recursive: true });
if (original.artifact.modules.some((file) => file.path === "application.js")) {
  throw new Error(
    "The protected proof entry would collide with an application module."
  );
}
for (const file of original.artifact.modules) {
  const subdirectory = ["_headers", "_redirects"].includes(file.path)
    ? "client"
    : "server";
  // oxlint-disable-next-line no-await-in-loop -- Copy only the manifest's verified modules; never rebuild them for this proof.
  const body = await readArtifactFile(
    path.join(values.directory, subdirectory),
    file
  );
  const destination = path.join(
    directory,
    subdirectory,
    file.path === "index.js" ? "application.js" : file.path
  );
  // oxlint-disable-next-line no-await-in-loop -- Bound copy operations while preserving module-relative imports.
  await mkdir(path.dirname(destination), { recursive: true });
  // oxlint-disable-next-line no-await-in-loop -- Retain exact compiled bytes under the isolated wrapper.
  await writeFile(destination, body);
}
for (const file of original.artifact.assets) {
  // oxlint-disable-next-line no-await-in-loop -- Reject changed browser bytes before upload.
  const body = await readArtifactFile(
    path.join(values.directory, "client"),
    file
  );
  const destination = path.join(directory, "client", file.path);
  // oxlint-disable-next-line no-await-in-loop -- Keep fixture copying bounded.
  await mkdir(path.dirname(destination), { recursive: true });
  // oxlint-disable-next-line no-await-in-loop -- Copy the tested assets without rebuilding.
  await writeFile(destination, body);
}
await writeFile(
  path.join(directory, "server/wrangler.json"),
  JSON.stringify({
    assets: { ...original.artifact.assetRouting, run_worker_first: true },
    compatibility_date: original.artifact.compatibilityDate,
    compatibility_flags: original.artifact.compatibilityFlags,
  })
);
await writeFile(
  path.join(directory, "server/index.js"),
  `
export default {
  async fetch(request, env, context) {
    if (typeof env.PROBE_TOKEN !== "string" || request.headers.get("authorization") !== "Bearer " + env.PROBE_TOKEN) return new Response(null, { status: 404 });
    const url = new URL(request.url);
    if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405 });
    if (url.pathname.startsWith("/assets/")) return env.ASSETS.fetch(request);
    if (url.pathname !== "/terms") return new Response(null, { status: 404 });
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("authorization");
    const { default: application } = await import("./application.js");
    return application.fetch(new Request(request, { headers }), env, context);
  }
};
`
);
const wrapped = await inventoryWorkerArtifact(
  directory,
  original.artifact.buildId,
  original.artifact.sourceSha
);
const manifest = await inventoryAssets(
  path.join(directory, "client"),
  wrapped.artifact.buildId,
  wrapped.digest
);
await writeFile(
  path.join(directory, "artifact.json"),
  JSON.stringify(releaseArtifactSchema.parse({ ...wrapped, archive: manifest }))
);
const client = createR2ArchiveClient({
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  bucket: outputs.archive,
  parentAccessKeyId: env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID,
  readOnly: false,
  token: env.CLOUDFLARE_API_TOKEN,
});
try {
  const archive = new AssetArchive(new S3ArchiveStore(client, outputs.archive));
  await archive.upload(path.join(directory, "client"), manifest);
  await archive.verify(manifest);
  const provider = new CloudflareRuntimeProvider(
    env.CLOUDFLARE_ACCOUNT_ID,
    env.CLOUDFLARE_API_TOKEN
  );
  const before = await provider.active(outputs.webScriptName);
  const receipt = await provider.uploadArtifact(
    outputs.webScriptName,
    before.versionId,
    wrapped.artifact,
    directory
  );
  await writeFile(
    path.join(root, ".scratch/web-proof-receipt.json"),
    JSON.stringify({
      ...receipt,
      baseline: before,
      directory,
      originalDigest: original.digest,
      scriptName: outputs.webScriptName,
    })
  );
  await verifyWebCandidate({
    ...receipt,
    baseline: before,
    directory,
    provider,
    publicUrl: outputs.webUrl,
    scriptName: outputs.webScriptName,
    token: env.QUIETER_RELEASE_PROBE_TOKEN,
  });
  process.stdout.write(
    `Verified protected TanStack SSR and exact browser assets from ${original.digest}; retained wrapper artifact ${wrapped.digest}. Runtime unchanged.\n`
  );
} finally {
  client.destroy();
}
