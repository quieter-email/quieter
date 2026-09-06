import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { readArtifactFile, releaseArtifactSchema } from "./artifact.ts";
import { verifyReleaseSourceMaps } from "./source-maps.ts";
import { trustedBuildSchema } from "./trusted-build.ts";
import type { TrustedBuild } from "./trusted-build.ts";

export const verifyTrustedBuildFiles = async (
  directory: string,
  input: TrustedBuild
) => {
  const build = trustedBuildSchema.parse(input);
  const rootMetadata = await lstat(directory);
  if (!path.isAbsolute(directory) || !rootMetadata.isDirectory()) {
    throw new Error(
      "Trusted build verification requires an absolute artifact directory."
    );
  }
  const manifestPath = path.join(directory, "artifact.json");
  const metadata = await lstat(manifestPath);
  if (!metadata.isFile() || metadata.size > 8_000_000) {
    throw new Error("Invalid downloaded build manifest.");
  }
  const manifest = releaseArtifactSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf-8"))
  );
  const { provenance } = manifest.artifact;
  if (
    manifest.artifact.sourceSha !== build.sourceSha ||
    provenance === undefined ||
    provenance.stage !== build.stage ||
    provenance.sourceTree !== build.sourceTree ||
    provenance.lockfileDigest !== build.lockfileDigest ||
    provenance.publicConfigurationDigest !== build.publicConfigurationDigest
  ) {
    throw new Error(
      "Downloaded artifact provenance does not match the trusted build and intended configuration."
    );
  }
  const files = [
    ...manifest.artifact.modules.map((file) => ({
      file,
      root: ["_headers", "_redirects"].includes(file.path)
        ? "client"
        : "server",
    })),
    ...manifest.artifact.assets.map((file) => ({ file, root: "client" })),
    ...provenance.sourceMaps.map((file) => ({ file, root: "source-maps" })),
  ];
  if (files.reduce((bytes, { file }) => bytes + file.bytes, 0) > 500_000_000) {
    throw new Error("Downloaded build exceeds the expanded artifact bound.");
  }
  const expected = new Map([
    ...files.map(({ file, root }): [string, number] => [
      `${root}/${file.path}`,
      file.bytes,
    ]),
    ["artifact.json", metadata.size],
  ]);
  const pending = [""];
  let entries = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- Walk the downloaded tree before reading or consuming any code.
    for (const entry of await readdir(path.join(directory, current), {
      withFileTypes: true,
    })) {
      entries += 1;
      const relative = current === "" ? entry.name : `${current}/${entry.name}`;
      if (entries > 30_000 || entry.isSymbolicLink()) {
        throw new Error(
          "Downloaded build contains a link or exceeds the entry bound."
        );
      }
      if (entry.isDirectory()) {
        if (
          ![...expected.keys()].some((file) => file.startsWith(`${relative}/`))
        ) {
          throw new Error("Downloaded build contains an unexpected directory.");
        }
        pending.push(relative);
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- Check sizes before allocating file buffers.
      const size = await lstat(path.join(directory, relative));
      if (!size.isFile() || expected.get(relative) !== size.size) {
        throw new Error("Downloaded build contains unlisted or changed files.");
      }
      expected.delete(relative);
    }
  }
  if (expected.size > 0) {
    throw new Error("Downloaded build is incomplete.");
  }
  for (let offset = 0; offset < files.length; offset += 5) {
    // oxlint-disable-next-line no-await-in-loop -- Verify every retained byte with bounded parallel reads.
    await Promise.all(
      files.slice(offset, offset + 5).map(async ({ file, root }) => {
        await readArtifactFile(path.join(directory, root), file);
      })
    );
  }
  await verifyReleaseSourceMaps(manifest, directory);
  return manifest;
};
