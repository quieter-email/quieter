import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { R2Bucket } from "@cloudflare/workers-types";
import { createDeploymentEnv } from "@quieter/env/deployment";
import { getPlatformProxy } from "wrangler";
import { z } from "zod";

import { inventoryWorkerArtifact } from "./artifact.ts";
import { AssetArchive, inventoryAssets } from "./assets.ts";
import { CloudflareRuntimeProvider } from "./cloudflare.ts";
import { R2ArchiveStore } from "./r2-archive-store.ts";

const env = createDeploymentEnv();
const root = path.resolve(import.meta.dirname, "../../..");
const outputs = z
  .object({ archive: z.string(), scriptName: z.string() })
  .parse(
    JSON.parse(await readFile(path.join(root, ".sst/outputs.json"), "utf-8"))
  );
if (
  !env.QUIETER_RELEASE_STAGE.startsWith("release-proof-") ||
  outputs.archive !== `${env.QUIETER_RELEASE_STAGE}-archive` ||
  !outputs.scriptName.includes(`-${env.QUIETER_RELEASE_STAGE}-`)
) {
  throw new Error(
    "Archive failure drills require the isolated proof bucket and Worker."
  );
}
const directory = path.join(
  root,
  ".scratch/release-archive-proof",
  randomUUID()
);
await Promise.all([
  mkdir(path.join(directory, "client/assets"), { recursive: true }),
  mkdir(path.join(directory, "server"), { recursive: true }),
]);
for (const index of [1, 2]) {
  const body = `export const proof = "${randomUUID()}-${index}";\n`;
  const digest = createHash("sha256").update(body).digest("hex");
  // oxlint-disable-next-line no-await-in-loop -- Each disposable object has unique content and an actual content hash.
  await writeFile(
    path.join(directory, "client/assets", `proof-${digest}.js`),
    body
  );
}
await Promise.all([
  writeFile(
    path.join(directory, "server/index.js"),
    "export default { fetch() { return new Response('archive proof'); } };\n"
  ),
  writeFile(
    path.join(directory, "server/wrangler.json"),
    JSON.stringify({
      compatibility_date: "2026-08-04",
      compatibility_flags: ["nodejs_compat"],
    })
  ),
  writeFile(
    path.join(directory, "wrangler.json"),
    JSON.stringify({
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
      compatibility_date: "2026-08-04",
      name: `${env.QUIETER_RELEASE_STAGE}-archive-check`,
      r2_buckets: [
        { binding: "Archive", bucket_name: outputs.archive, remote: true },
      ],
    })
  ),
]);
const { digest } = await inventoryWorkerArtifact(
  directory,
  "archive-proof",
  "0".repeat(40)
);
const manifest = await inventoryAssets(
  path.join(directory, "client"),
  "archive-proof",
  digest
);
const runtime = new CloudflareRuntimeProvider(
  env.CLOUDFLARE_ACCOUNT_ID,
  env.CLOUDFLARE_API_TOKEN
);
const before = await runtime.active(outputs.scriptName);
const proxy = await getPlatformProxy<{ Archive: R2Bucket }>({
  configPath: path.join(directory, "wrangler.json"),
  envFiles: [],
  persist: false,
  remoteBindings: true,
});
try {
  const store = new R2ArchiveStore(proxy.env.Archive);
  let writes = 0;
  const interrupted = new AssetArchive({
    create: async (key, body, contentType) => {
      writes += 1;
      if (writes === 2) {
        throw new Error("Injected archive interruption.");
      }
      await store.create(key, body, contentType);
    },
    read: store.read.bind(store),
  });
  await assert.rejects(
    interrupted.upload(path.join(directory, "client"), manifest),
    /Injected archive interruption/u
  );
  assert.equal(await proxy.env.Archive.head(`receipts/${digest}.json`), null);
  const archive = new AssetArchive(store);
  await archive.upload(path.join(directory, "client"), manifest);
  await archive.verify(manifest);
  await archive.upload(path.join(directory, "client"), manifest);
  await proxy.env.Archive.delete(manifest.files[0].path);
  await assert.rejects(
    archive.verify(manifest),
    /size or content type mismatch/u
  );
  await archive.upload(path.join(directory, "client"), manifest);
  await archive.verify(manifest);
  assert.deepEqual(await runtime.active(outputs.scriptName), before);
  process.stdout.write(
    "Verified remote R2 conditional writes, interrupted upload without receipt, idempotent repair, missing-object detection behind a receipt, and unchanged runtime deployment.\n"
  );
} finally {
  await proxy.dispose();
}
