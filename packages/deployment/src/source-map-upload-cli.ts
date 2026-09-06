import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { S3Client } from "@aws-sdk/client-s3";
import {
  createReleaseStorageEnv,
  createSourceMapUploadEnv,
} from "@quieter/env/deployment";

import { releaseArtifactSchema } from "./artifact.ts";
import { SourceMapReceiptStore } from "./source-map-store.ts";
import { uploadReleaseSourceMaps } from "./source-map-upload.ts";

const { values } = parseArgs({
  options: { directory: { type: "string" }, receipt: { type: "string" } },
});
if (
  values.directory === undefined ||
  values.receipt === undefined ||
  !path.isAbsolute(values.directory) ||
  !path.isAbsolute(values.receipt)
) {
  throw new Error(
    "Source-map upload requires absolute --directory and new --receipt paths."
  );
}
const existing = await lstat(values.receipt).catch((error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return null;
  }
  throw new Error("Cannot inspect the source-map receipt path.");
});
if (existing !== null) {
  throw new Error("Source-map upload requires a new receipt path.");
}
const env = createReleaseStorageEnv();
const destination = createSourceMapUploadEnv();
const storage = new S3Client({
  maxAttempts: 1,
  region: env.AWS_REGION,
  requestHandler: {
    connectionTimeout: 5000,
    requestTimeout: 15_000,
    throwOnRequestTimeout: true,
  },
});
const manifest = releaseArtifactSchema.parse(
  JSON.parse(
    await readFile(path.join(values.directory, "artifact.json"), "utf-8")
  )
);
try {
  const receipt = await uploadReleaseSourceMaps({
    destination,
    directory: values.directory,
    manifest,
  });
  const retained = await new SourceMapReceiptStore(
    storage,
    env.QUIETER_RELEASE_BUCKET,
    destination
  ).retain(manifest, receipt);
  await writeFile(values.receipt, JSON.stringify(retained, null, 2), {
    flag: "wx",
  });
  process.stdout.write(
    `Verified source-map processing for artifact ${receipt.artifactDigest}, ${receipt.files} code/map pairs.\n`
  );
} finally {
  storage.destroy();
}
