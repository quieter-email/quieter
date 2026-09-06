import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { createDeploymentEnv } from "@quieter/env/deployment";

import { S3ArchiveStore } from "./archive-store.ts";
import { readArtifactFile, releaseArtifactSchema } from "./artifact.ts";
import { AssetArchive } from "./assets.ts";
import { createR2ArchiveClient } from "./r2-archive-client.ts";

const { values } = parseArgs({
  options: {
    bucket: { type: "string" },
    directory: { type: "string" },
    manifest: { type: "string" },
    verify: { default: false, type: "boolean" },
  },
});
const env = createDeploymentEnv();
if (
  !env.QUIETER_RELEASE_STAGE.startsWith("release-proof-") ||
  values.bucket !== `${env.QUIETER_RELEASE_STAGE}-archive` ||
  values.directory === undefined ||
  values.manifest === undefined ||
  env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID === undefined
) {
  throw new Error(
    "Archive operations require --directory, --manifest, and the isolated stage's --bucket until cutover is verified."
  );
}
const manifest = releaseArtifactSchema.parse(
  JSON.parse(await readFile(values.manifest, "utf-8"))
);
if (manifest.archive === null) {
  throw new Error("This artifact has no browser files to archive.");
}
for (const module of manifest.artifact.modules) {
  const directory = ["_headers", "_redirects"].includes(module.path)
    ? "client"
    : "server";
  // oxlint-disable-next-line no-await-in-loop -- Verify the complete built artifact before uploading its browser files.
  await readArtifactFile(path.join(values.directory, directory), module);
}
const client = createR2ArchiveClient({
  accountId: env.CLOUDFLARE_ACCOUNT_ID,
  bucket: values.bucket,
  parentAccessKeyId: env.CLOUDFLARE_ARCHIVE_PARENT_KEY_ID,
  readOnly: values.verify,
  token: env.CLOUDFLARE_API_TOKEN,
});
try {
  const archive = new AssetArchive(new S3ArchiveStore(client, values.bucket));
  if (!values.verify) {
    await archive.upload(
      path.join(values.directory, "client"),
      manifest.archive
    );
  }
  await archive.verify(manifest.archive);
  process.stdout.write(
    `Verified archive receipt for ${manifest.digest}, ${manifest.archive.files.length} browser assets.\n`
  );
} finally {
  client.destroy();
}
