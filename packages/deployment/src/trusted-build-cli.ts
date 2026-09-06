import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { S3Client } from "@aws-sdk/client-s3";
import { createWebReleaseEnvironment } from "@quieter/env/build";
import {
  createTrustedBuildEnv,
  createReleaseStorageEnv,
} from "@quieter/env/deployment";
import { z } from "zod";

import { verifyTrustedBuildFiles } from "./trusted-build-files.ts";
import { TrustedBuildReceiptStore } from "./trusted-build-store.ts";
import { verifyTrustedBuild } from "./trusted-build.ts";

const { values } = parseArgs({
  options: {
    "archive-digest": { type: "string" },
    "artifact-id": { type: "string" },
    directory: { type: "string" },
    "public-config": { type: "string" },
    receipt: { type: "string" },
    retain: { default: false, type: "boolean" },
    run: { type: "string" },
    service: { default: "web", type: "string" },
    stage: { type: "string" },
  },
});
if (
  values.run === undefined ||
  !/^[1-9]\d*$/u.test(values.run) ||
  values.stage === undefined ||
  values.receipt === undefined ||
  values["public-config"] === undefined ||
  !path.isAbsolute(values.receipt) ||
  !path.isAbsolute(values["public-config"])
) {
  throw new Error(
    "Trusted build verification requires --run, --stage, and absolute --public-config and new --receipt paths."
  );
}
const env = createTrustedBuildEnv();
const { publicConfiguration } = createWebReleaseEnvironment(
  JSON.parse(await readFile(values["public-config"], "utf-8"))
);
const build = await verifyTrustedBuild({
  expectedArtifact:
    values.directory === undefined
      ? undefined
      : z
          .object({
            digest: z.string().regex(/^[a-f\d]{64}$/u),
            id: z.number().int().positive(),
          })
          .parse({
            digest: values["archive-digest"],
            id: Number(values["artifact-id"]),
          }),
  publicConfigurationDigest: createHash("sha256")
    .update(JSON.stringify(publicConfiguration))
    .digest("hex"),
  repository: env.GITHUB_REPOSITORY,
  runId: z.number().int().positive().parse(Number(values.run)),
  service: values.service,
  stage: values.stage,
  token: env.GITHUB_TOKEN,
});
const manifest =
  values.directory === undefined
    ? undefined
    : await verifyTrustedBuildFiles(values.directory, build);
if (values.retain) {
  if (manifest === undefined) {
    throw new Error(
      "Retaining CI evidence requires verified downloaded artifact files."
    );
  }
  const destination = createReleaseStorageEnv();
  if (destination.QUIETER_RELEASE_STAGE !== values.stage) {
    throw new Error("Trusted build retention stage differs from verification.");
  }
  const storage = new S3Client({
    maxAttempts: 1,
    region: destination.AWS_REGION,
    requestHandler: {
      connectionTimeout: 5000,
      requestTimeout: 15_000,
      throwOnRequestTimeout: true,
    },
  });
  try {
    await new TrustedBuildReceiptStore(
      storage,
      destination.QUIETER_RELEASE_BUCKET,
      destination.QUIETER_RELEASE_STAGE,
      env.GITHUB_REPOSITORY
    ).retain(manifest, build);
  } finally {
    storage.destroy();
  }
}
await writeFile(
  values.receipt,
  JSON.stringify({ artifactDigest: manifest?.digest ?? null, build }, null, 2),
  { flag: "wx" }
);
if (env.GITHUB_OUTPUT !== undefined) {
  await appendFile(
    env.GITHUB_OUTPUT,
    `artifact-id=${build.artifactId}\narchive-digest=${build.archiveDigest}\nsource-sha=${build.sourceSha}\nartifact-digest=${manifest?.digest ?? ""}\n`
  );
}
process.stdout.write(
  `Verified trusted build ${build.runId}, attempt ${build.runAttempt}, source ${build.sourceSha}${manifest === undefined ? "" : `, artifact ${manifest.digest}`}\n`
);
