import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import MagicString from "magic-string";
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

export const prepareGeneratedSourceMaps = async (directory: string) => {
  const pending = ["client", "server"];
  let inspected = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- Inspect generated output without unbounded concurrent file access.
    const entries = await readdir(path.join(directory, current), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      inspected += 1;
      if (entry.isSymbolicLink() || inspected > 25_000) {
        throw new Error("Unexpected generated build inventory.");
      }
      const relative = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push(relative);
        continue;
      }
      if (!entry.isFile() || !/\.(?:c|m)?js$/u.test(entry.name)) {
        continue;
      }
      const file = path.join(directory, relative);
      // oxlint-disable-next-line no-await-in-loop -- Preserve every existing compiler map.
      const existing = await lstat(`${file}.map`).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return null;
        }
        throw new Error("Could not inspect generated source map.");
      });
      if (existing !== null) {
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- Only known compiler-generated helpers receive an identity map.
      const code = await readFile(file, "utf-8");
      if (
        Buffer.byteLength(code) > 64_000 ||
        !(
          code.startsWith("//#region \\0rolldown/runtime.js\n") ||
          code.startsWith("//#region \\0tanstack-start-manifest:v\n") ||
          /^import\s+\{[^{};]+\}\s+from\s+"[^"\r\n]+";\s*export\s+\{[^{};]+\};?\s*$/u.test(
            code
          )
        )
      ) {
        throw new Error(
          "Application JavaScript is missing its compiler source map."
        );
      }
      const map = new MagicString(code).generateMap({
        file: entry.name,
        hires: true,
        includeContent: true,
        source: `generated/${relative}`,
      });
      // oxlint-disable-next-line no-await-in-loop -- The generated source is the helper itself, not an invented original application file.
      await writeFile(`${file}.map`, map.toString(), { flag: "wx" });
    }
  }
};

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
