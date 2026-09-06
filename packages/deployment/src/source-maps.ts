import path from "node:path";

import { z } from "zod";

import { readArtifactFile, releaseArtifactSchema } from "./artifact.ts";
import type { ReleaseArtifact } from "./artifact.ts";

const mapSchema = z.object({
  debugId: z.uuid().optional(),
  debug_id: z.uuid(),
  mappings: z.string(),
  sources: z.array(z.string()),
  sourcesContent: z.array(z.string()),
  version: z.literal(3),
});

export const verifyReleaseSourceMaps = async (
  input: ReleaseArtifact,
  directory: string
) => {
  const manifest = releaseArtifactSchema.parse(input);
  const maps = manifest.artifact.provenance?.sourceMaps;
  if (maps === undefined || !path.isAbsolute(directory)) {
    throw new Error(
      "Source-map verification requires a retained build and absolute directory."
    );
  }
  const files = [
    ...manifest.artifact.modules.map((file) => ({ file, root: "server" })),
    ...manifest.artifact.assets.map((file) => ({ file, root: "client" })),
  ].filter(({ file }) => /\.(?:c|m)?js$/u.test(file.path));
  const identities = new Map<string, string>();
  const verified = [];
  for (const { file, root } of files) {
    const map = maps.find((entry) => entry.path === `${root}/${file.path}.map`);
    if (map === undefined) {
      throw new Error("Compiled JavaScript has no retained source map.");
    }
    // oxlint-disable-next-line no-await-in-loop -- Keep byte verification bounded before uploading any source code.
    const [codeBytes, mapBytes] = await Promise.all([
      readArtifactFile(path.join(directory, root), file),
      readArtifactFile(path.join(directory, "source-maps"), map),
    ]);
    const sourceMap = mapSchema.parse(JSON.parse(mapBytes.toString("utf-8")));
    const code = codeBytes.toString("utf-8");
    const markers = [...code.matchAll(/\/\/# debugId=(?<id>[a-f\d-]{36})/gu)];
    const identity = `${file.digest}:${map.digest}`;
    const existing = identities.get(sourceMap.debug_id);
    if (
      markers.length !== 1 ||
      markers[0].groups?.id !== sourceMap.debug_id ||
      !code.includes("_sentryDebugIds") ||
      (sourceMap.debugId !== undefined &&
        sourceMap.debugId !== sourceMap.debug_id) ||
      sourceMap.sources.length !== sourceMap.sourcesContent.length ||
      (existing !== undefined && existing !== identity)
    ) {
      throw new Error(
        "Compiled JavaScript and source-map debug identities do not match."
      );
    }
    identities.set(sourceMap.debug_id, identity);
    verified.push({ debugId: sourceMap.debug_id, file, map, root });
  }
  if (verified.length === 0) {
    throw new Error("The release has no verifiable JavaScript source maps.");
  }
  return verified;
};
