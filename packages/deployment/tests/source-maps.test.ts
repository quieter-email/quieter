import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createWebReleaseEnvironment } from "@quieter/env/build";
import SentryCli from "@sentry/cli";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import {
  inventoryWorkerArtifact,
  releaseArtifactSchema,
} from "../src/artifact.ts";
import { uploadReleaseSourceMaps } from "../src/source-map-upload.ts";
import {
  prepareGeneratedSourceMaps,
  verifyReleaseSourceMaps,
} from "../src/source-maps.ts";
import { verifyTrustedBuildFiles } from "../src/trusted-build-files.ts";

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

describe("retained source-map identities", { timeout: 15_000 }, () => {
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

  it("checks downloaded bytes against trusted provenance and rejects extra files", async () => {
    const { directory, manifest } = await buildFixture();
    await rm(path.join(directory, "server/index.js.map"));
    await rm(path.join(directory, "server/wrangler.json"));
    await rmdir(path.join(directory, "client"));
    await writeFile(
      path.join(directory, "artifact.json"),
      JSON.stringify(manifest)
    );
    const build = {
      archiveDigest: "f".repeat(64),
      artifactId: 1,
      artifactName: "fixture",
      lockfileDigest: "c".repeat(64),
      publicConfigurationDigest: "d".repeat(64),
      repository: "fixture/repository",
      runAttempt: 1,
      runId: 1,
      schemaVersion: 1 as const,
      sourceSha: "a".repeat(40),
      sourceTree: "e".repeat(40),
      stage: "release-proof-maps",
    };
    await expect(
      verifyTrustedBuildFiles(directory, build)
    ).resolves.toStrictEqual(manifest);
    await expect(
      verifyTrustedBuildFiles(directory, { ...build, stage: "production" })
    ).rejects.toThrow("provenance");
    await expect(
      verifyTrustedBuildFiles(directory, { ...build, service: "mail-sender" })
    ).rejects.toThrow("provenance");
    await writeFile(path.join(directory, "server/unlisted.js"), "unlisted");
    await expect(verifyTrustedBuildFiles(directory, build)).rejects.toThrow(
      "unlisted"
    );
    await rm(path.join(directory, "server/unlisted.js"));
    await writeFile(path.join(directory, "server/index.js"), "corrupt");
    await expect(verifyTrustedBuildFiles(directory, build)).rejects.toThrow(
      "changed files"
    );
  });

  it("uploads only verified pairs and removes the upload directory after processing", async () => {
    const fixture = await buildFixture();
    let uploadDirectory = "";
    const receipt = await uploadReleaseSourceMaps(
      {
        ...fixture,
        destination: {
          organization: "fixture",
          project: "fixture-staging",
          stage: "release-proof-maps",
          token: "test-secret",
          url: "https://de.sentry.io",
        },
      },
      async (directory) => {
        uploadDirectory = directory;
        await expect(
          readdir(path.join(directory, "server"))
        ).resolves.toStrictEqual(["index.js", "index.js.map"]);
        await expect(
          readFile(path.join(directory, "server/index.js"))
        ).resolves.toStrictEqual(
          await readFile(path.join(fixture.directory, "server/index.js"))
        );
      }
    );
    expect(receipt).toMatchObject({
      artifactDigest: fixture.manifest.digest,
      files: 1,
      project: "fixture-staging",
    });
    expect(JSON.stringify(receipt)).not.toContain("test-secret");
    await expect(stat(uploadDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not acknowledge an unsuccessful upload and cleans its temporary copies", async () => {
    const fixture = await buildFixture();
    let uploadDirectory = "";
    await expect(
      uploadReleaseSourceMaps(
        {
          ...fixture,
          destination: {
            organization: "fixture",
            project: "fixture-staging",
            stage: "release-proof-maps",
            token: "test-secret",
            url: "https://de.sentry.io",
          },
        },
        async (directory) => {
          uploadDirectory = directory;
          await Promise.reject(new Error("Upload failed"));
        }
      )
    ).rejects.toThrow("Upload failed");
    await expect(stat(uploadDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      verifyReleaseSourceMaps(fixture.manifest, fixture.directory)
    ).resolves.toHaveLength(1);
  });

  it("never invokes the uploader for the wrong stage or changed retained bytes", async () => {
    const fixture = await buildFixture();
    const upload = vi.fn<() => Promise<void>>();
    const destination = {
      organization: "fixture",
      project: "fixture-staging",
      stage: "production",
      token: "test-secret",
      url: "https://de.sentry.io" as const,
    };
    await expect(
      uploadReleaseSourceMaps({ ...fixture, destination }, upload)
    ).rejects.toThrow("build stage");
    destination.stage = "release-proof-maps";
    await writeFile(path.join(fixture.directory, "server/index.js"), "corrupt");
    await expect(
      uploadReleaseSourceMaps({ ...fixture, destination }, upload)
    ).rejects.toThrow("bytes changed");
    expect(upload).not.toHaveBeenCalled();
  });

  it("maps known generated helpers to their actual source and rejects unmapped application code", async () => {
    const { directory } = await buildFixture();
    const generated =
      "//#region \\0rolldown/runtime.js\nvar helper = Object.create;\n";
    await writeFile(path.join(directory, "server/runtime.js"), generated);
    await prepareGeneratedSourceMaps(directory);
    const map = z
      .object({
        sources: z.array(z.string()),
        sourcesContent: z.array(z.string()),
      })
      .parse(
        JSON.parse(
          await readFile(path.join(directory, "server/runtime.js.map"), "utf-8")
        )
      );
    expect(map).toStrictEqual({
      sources: ["generated/server/runtime.js"],
      sourcesContent: [generated],
    });
    await writeFile(
      path.join(directory, "server/application.js"),
      "export function lostSource() {};"
    );
    await expect(prepareGeneratedSourceMaps(directory)).rejects.toThrow(
      "missing its compiler source map"
    );
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
