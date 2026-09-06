import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createWebReleaseEnvironment } from "@quieter/env/build";
import SentryCli from "@sentry/cli";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  inventoryWorkerArtifact,
  releaseArtifactSchema,
} from "../src/artifact.ts";
import { verifyReleaseSourceMaps } from "../src/source-maps.ts";

// oxlint-disable-next-line strict-void-return -- promisify waits for the subprocess callback.
const execute = promisify(execFile);
const directories: string[] = [];

const buildFixture = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "quieter-source-maps-"));
  directories.push(directory);
  await mkdir(path.join(directory, "server"));
  await mkdir(path.join(directory, "client"));
  await mkdir(path.join(directory, "source-maps/server"), { recursive: true });
  const code = "export default { fetch() { throw new Error('fixture'); } };";
  await writeFile(path.join(directory, "server/index.js"), code);
  await writeFile(
    path.join(directory, "server/index.js.map"),
    JSON.stringify({
      file: "index.js",
      mappings: "AAAA",
      names: [],
      sources: ["fixture.ts"],
      sourcesContent: [code],
      version: 3,
    })
  );
  await writeFile(
    path.join(directory, "server/wrangler.json"),
    JSON.stringify({
      compatibility_date: "2026-08-04",
      compatibility_flags: ["nodejs_compat"],
    })
  );
  await execute(
    SentryCli.getPath(),
    ["sourcemaps", "inject", "--quiet", path.join(directory, "server")],
    {
      cwd: directory,
      env: createWebReleaseEnvironment({}).environment,
      timeout: 10_000,
      windowsHide: true,
    }
  );
  const map = await readFile(path.join(directory, "server/index.js.map"));
  await writeFile(path.join(directory, "source-maps/server/index.js.map"), map);
  const inventory = await inventoryWorkerArtifact(
    directory,
    "fixture",
    "a".repeat(40),
    {
      buildConfigDigest: "b".repeat(64),
      command: "vp run --no-cache @quieter/web#build",
      lockfileDigest: "c".repeat(64),
      nodeVersion: process.version,
      publicConfigurationDigest: "d".repeat(64),
      sourceMaps: [
        {
          bytes: map.byteLength,
          contentType: "application/json",
          digest: createHash("sha256").update(map).digest("hex"),
          path: "server/index.js.map",
        },
      ],
      sourceTree: "e".repeat(40),
      stage: "release-proof-maps",
      toolchain: "fixture",
    }
  );
  return {
    directory,
    manifest: releaseArtifactSchema.parse({ ...inventory, archive: null }),
  };
};

describe("retained source-map identities", () => {
  afterEach(async () => {
    for (const directory of directories.splice(0)) {
      if (
        path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) ||
        !path.basename(directory).startsWith("quieter-source-maps-")
      ) {
        throw new Error("Unexpected source-map fixture directory.");
      }
      // oxlint-disable-next-line no-await-in-loop -- Clean only verified test directories.
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("verifies the installed offline injector's compiled code and map as a pair", async () => {
    const { directory, manifest } = await buildFixture();
    await expect(
      verifyReleaseSourceMaps(manifest, directory)
    ).resolves.toHaveLength(1);
  });

  it("rejects missing coverage before any source-map upload", async () => {
    const { directory, manifest } = await buildFixture();
    if (manifest.artifact.provenance === undefined) {
      throw new Error("Missing fixture provenance.");
    }
    manifest.artifact.provenance.sourceMaps[0].path = "server/other.js.map";
    manifest.digest = createHash("sha256")
      .update(JSON.stringify(manifest.artifact))
      .digest("hex");
    await expect(verifyReleaseSourceMaps(manifest, directory)).rejects.toThrow(
      "no retained source map"
    );
  });

  it("rejects changed compiled bytes and maps without valid debug metadata", async () => {
    const { directory, manifest } = await buildFixture();
    const bytes = Buffer.from(JSON.stringify({ version: 3 }));
    if (manifest.artifact.provenance === undefined) {
      throw new Error("Missing fixture provenance.");
    }
    await writeFile(
      path.join(directory, "source-maps/server/index.js.map"),
      bytes
    );
    const [map] = manifest.artifact.provenance.sourceMaps;
    map.bytes = bytes.byteLength;
    map.digest = createHash("sha256").update(bytes).digest("hex");
    manifest.digest = createHash("sha256")
      .update(JSON.stringify(manifest.artifact))
      .digest("hex");
    await expect(verifyReleaseSourceMaps(manifest, directory)).rejects.toThrow(
      "debug_id"
    );
    await writeFile(path.join(directory, "server/index.js"), "changed");
    await expect(verifyReleaseSourceMaps(manifest, directory)).rejects.toThrow(
      "bytes changed"
    );
  });
});
