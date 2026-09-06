import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createWebReleaseEnvironment } from "@quieter/env/build";
import type { createSourceMapUploadEnv } from "@quieter/env/deployment";
import SentryCli from "@sentry/cli";
import { z } from "zod";

import { readArtifactFile, releaseArtifactSchema } from "./artifact.ts";
import type { ReleaseArtifact } from "./artifact.ts";
import { digestSchema, identifierSchema } from "./schema.ts";
import { verifyReleaseSourceMaps } from "./source-maps.ts";

type Destination = ReturnType<typeof createSourceMapUploadEnv>;
// oxlint-disable-next-line strict-void-return -- promisify waits for the subprocess callback.
const execute = promisify(execFile);

export const sourceMapUploadReceiptSchema = z.strictObject({
  artifactDigest: digestSchema,
  buildId: identifierSchema,
  completedAt: z.iso.datetime(),
  files: z.number().int().positive(),
  id: z.uuid(),
  organization: identifierSchema,
  project: identifierSchema,
  schemaVersion: z.literal(1),
  stage: identifierSchema,
  toolchain: z.string().min(1),
  url: z.enum([
    "https://sentry.io",
    "https://de.sentry.io",
    "https://us.sentry.io",
  ]),
});

const uploadSourceMapDirectory = async (
  directory: string,
  destination: Destination
) => {
  try {
    await execute(
      SentryCli.getPath(),
      [
        "--url",
        destination.url,
        "sourcemaps",
        "upload",
        "--org",
        destination.organization,
        "--project",
        destination.project,
        "--no-rewrite",
        "--strict",
        "--wait",
        "--wait-for",
        "120",
        directory,
      ],
      {
        cwd: directory,
        env: {
          ...createWebReleaseEnvironment({}).environment,
          SENTRY_AUTH_TOKEN: destination.token,
          SENTRY_DISABLE_UPDATE_CHECK: "true",
          SENTRY_LOG_LEVEL: "error",
        },
        maxBuffer: 1_000_000,
        timeout: 180_000,
        windowsHide: true,
      }
    );
  } catch {
    throw new Error(
      "Source-map upload did not confirm processing. No completion receipt was written."
    );
  }
};

export const uploadReleaseSourceMaps = async (
  input: {
    manifest: ReleaseArtifact;
    directory: string;
    destination: Destination;
  },
  upload: (
    directory: string,
    destination: Destination
  ) => Promise<void> = uploadSourceMapDirectory
) => {
  const manifest = releaseArtifactSchema.parse(input.manifest);
  if (manifest.artifact.provenance?.stage !== input.destination.stage) {
    throw new Error(
      "Source-map destination does not match the retained build stage."
    );
  }
  const files = await verifyReleaseSourceMaps(manifest, input.directory);
  const directory = await mkdtemp(path.join(tmpdir(), "quieter-map-upload-"));
  if (
    path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) ||
    !path.basename(directory).startsWith("quieter-map-upload-")
  ) {
    throw new Error("Unexpected source-map upload directory.");
  }
  try {
    for (const { file, map, root } of files) {
      // oxlint-disable-next-line no-await-in-loop -- Upload only individually verified code/map pairs in a fresh directory.
      const [codeBytes, mapBytes] = await Promise.all([
        readArtifactFile(path.join(input.directory, root), file),
        readArtifactFile(path.join(input.directory, "source-maps"), map),
      ]);
      const destination = path.join(directory, root, file.path);
      // oxlint-disable-next-line no-await-in-loop -- Preserve relative code/map pairing without including unrelated local files.
      await mkdir(path.dirname(destination), { recursive: true });
      // oxlint-disable-next-line no-await-in-loop -- Complete each pair before giving the directory to the uploader.
      await Promise.all([
        writeFile(destination, codeBytes, { flag: "wx" }),
        writeFile(`${destination}.map`, mapBytes, { flag: "wx" }),
      ]);
    }
    await upload(directory, input.destination);
    await verifyReleaseSourceMaps(manifest, input.directory);
    return sourceMapUploadReceiptSchema.parse({
      artifactDigest: manifest.digest,
      buildId: manifest.artifact.buildId,
      completedAt: new Date().toISOString(),
      files: files.length,
      id: randomUUID(),
      organization: input.destination.organization,
      project: input.destination.project,
      schemaVersion: 1,
      stage: input.destination.stage,
      toolchain: SentryCli.getVersion(),
      url: input.destination.url,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};
