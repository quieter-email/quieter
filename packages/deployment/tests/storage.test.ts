import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { S3ArchiveStore } from "../src/archive-store.ts";
import { ReleaseArtifactStore } from "../src/artifact-store.ts";
import {
  artifactSchema,
  inventoryWorkerArtifact,
  releaseArtifactSchema,
} from "../src/artifact.ts";
import { AssetArchive, inventoryAssets } from "../src/assets.ts";
import type { CloudflareRuntimeProvider } from "../src/cloudflare.ts";
import { ObjectReleaseJournal } from "../src/journal.ts";
import { ReleasePreflight } from "../src/preflight.ts";
import type { ReleaseState } from "../src/schema.ts";
import { ObjectUploadStore } from "../src/upload-store.ts";

const directories: string[] = [];
// oxlint-disable-next-line vitest/require-top-level-describe -- Shared cleanup covers every storage test below.
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    directories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
});

const objectStore = () => {
  const objects = new Map<
    string,
    { body: Buffer; contentType: string; etag: string }
  >();
  const writes: string[] = [];
  const client = new S3Client({
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    region: "eu-central-1",
  });
  /* oxlint-disable no-misused-promises, strict-void-return, require-await -- AWS send's last overload is callback-based; these tests exercise its Promise overload. */
  vi.spyOn(client, "send").mockImplementation(async (command) => {
    if (
      !(
        command instanceof GetObjectCommand ||
        command instanceof PutObjectCommand
      ) ||
      command.input.Key === undefined
    ) {
      throw new Error("Unexpected object operation.");
    }
    const { Key: key } = command.input;
    const existing = objects.get(key);
    if (command instanceof GetObjectCommand) {
      if (!existing) {
        throw Object.assign(new Error("Missing object"), { name: "NoSuchKey" });
      }
      return {
        Body: {
          transformToByteArray: async () =>
            await Promise.resolve(existing.body),
          transformToString: async () =>
            await Promise.resolve(existing.body.toString()),
        },
        ContentLength: existing.body.byteLength,
        ContentType: existing.contentType,
        ETag: existing.etag,
      };
    }
    if (
      (command.input.IfNoneMatch === "*" && existing !== undefined) ||
      (command.input.IfMatch !== undefined &&
        command.input.IfMatch !== existing?.etag)
    ) {
      throw Object.assign(new Error("Precondition failed"), {
        name: "PreconditionFailed",
      });
    }
    const body = command.input.Body;
    if (!(typeof body === "string" || Buffer.isBuffer(body))) {
      throw new Error("Expected bounded object bytes.");
    }
    const bytes = Buffer.from(body);
    const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
    objects.set(key, {
      body: bytes,
      contentType: command.input.ContentType ?? "",
      etag,
    });
    writes.push(key);
    return { ETag: etag };
  });
  /* oxlint-enable no-misused-promises, strict-void-return, require-await */
  return { client, objects, writes };
};

const build = async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "quieter-assets-"));
  directories.push(directory);
  await mkdir(path.join(directory, "assets/fonts"), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(directory, "assets/page-abcdefgh.js"),
      "export const value = 1;"
    ),
    writeFile(
      path.join(directory, "assets/fonts/body-12345678.woff2"),
      "font fixture"
    ),
    writeFile(path.join(directory, "assets/build-id.txt"), "build"),
    writeFile(
      path.join(directory, "assets/page-abcdefgh.js.map"),
      "private source map"
    ),
  ]);
  const manifest = await inventoryAssets(directory, "build", "a".repeat(64));
  return { directory, manifest };
};

describe("immutable archive and durable journal", () => {
  /* oxlint-disable vitest/max-expects -- One retained artifact exercises privacy, corruption, and version compatibility together. */
  it("retains provenance and private source maps without adding them to public assets", async () => {
    const { client, objects } = objectStore();
    const directory = await mkdtemp(path.join(tmpdir(), "quieter-provenance-"));
    directories.push(directory);
    await mkdir(path.join(directory, "server"));
    await mkdir(path.join(directory, "client"));
    await mkdir(path.join(directory, "source-maps/client"), {
      recursive: true,
    });
    const map = Buffer.from('{"version":3,"sources":["private-source.ts"]}');
    await Promise.all([
      writeFile(
        path.join(directory, "server/wrangler.json"),
        JSON.stringify({
          compatibility_date: "2026-08-04",
          compatibility_flags: [],
        })
      ),
      writeFile(path.join(directory, "server/index.js"), "export default {}"),
      writeFile(path.join(directory, "source-maps/client/page.js.map"), map),
    ]);
    const manifest = {
      ...(await inventoryWorkerArtifact(directory, "build", "a".repeat(40), {
        buildConfigDigest: "b".repeat(64),
        command: "vp run --no-cache @quieter/web#build",
        lockfileDigest: "c".repeat(64),
        nodeVersion: "v24.18.0",
        publicConfigurationDigest: "d".repeat(64),
        sourceMaps: [
          {
            bytes: map.byteLength,
            contentType: "application/json",
            digest: createHash("sha256").update(map).digest("hex"),
            path: "client/page.js.map",
          },
        ],
        sourceTree: "e".repeat(40),
        stage: "review",
        toolchain: "fixture",
      })),
      archive: null,
    };
    expect(manifest.artifact.schemaVersion).toBe(2);
    expect(manifest.artifact.assets).toHaveLength(0);
    const store = new ReleaseArtifactStore(client, "journal", "test");
    await store.retain(manifest, directory);
    const restored = path.join(directory, "restored");
    await expect(
      store.restore(manifest.digest, restored)
    ).resolves.toStrictEqual(manifest);
    await expect(
      readFile(path.join(restored, "source-maps/client/page.js.map"))
    ).resolves.toStrictEqual(map);
    await expect(
      readFile(path.join(restored, "client/page.js.map"))
    ).rejects.toThrow("ENOENT");
    objects.delete(
      `test/compiled/${manifest.digest}/source-maps/client/page.js.map`
    );
    await expect(
      store.restore(manifest.digest, path.join(directory, "missing-map"))
    ).rejects.toThrow("Missing object");
    expect(() =>
      artifactSchema.parse({ ...manifest.artifact, schemaVersion: 1 })
    ).toThrow("build provenance");
    expect(() =>
      artifactSchema.parse({ ...manifest.artifact, provenance: undefined })
    ).toThrow("build provenance");
  });

  /* oxlint-enable vitest/max-expects */
  it("retains exact compiled files before the receipt and restores without rebuilding", async () => {
    const { client, objects, writes } = objectStore();
    const directory = await mkdtemp(path.join(tmpdir(), "quieter-compiled-"));
    directories.push(directory);
    const original = path.join(directory, "original");
    await mkdir(path.join(original, "server"), { recursive: true });
    await mkdir(path.join(original, "client"));
    await Promise.all([
      writeFile(
        path.join(original, "server/wrangler.json"),
        JSON.stringify({
          compatibility_date: "2026-08-04",
          compatibility_flags: ["nodejs_compat"],
        })
      ),
      writeFile(path.join(original, "server/index.js"), "export default {}"),
      writeFile(
        path.join(original, "server/index.js.map"),
        "private source map"
      ),
      writeFile(path.join(original, "client/_headers"), "/*\n  x-proof: true"),
      writeFile(path.join(original, "client/favicon.svg"), "<svg />"),
    ]);
    const manifest = {
      ...(await inventoryWorkerArtifact(original, "proof", "a".repeat(40))),
      archive: null,
    };
    const store = new ReleaseArtifactStore(client, "journal", "test");
    await store.retain(manifest, original);
    const receiptKey = `test/compiled/${manifest.digest}/receipt.json`;
    expect(writes.at(-1)).toBe(receiptKey);
    const restored = path.join(directory, "restored");
    await store.restore(manifest.digest, restored);
    await expect(
      readFile(path.join(restored, "server/index.js"), "utf-8")
    ).resolves.toBe("export default {}");
    await expect(
      readFile(path.join(restored, "client/_headers"), "utf-8")
    ).resolves.toBe("/*\n  x-proof: true");
    await expect(
      readFile(path.join(restored, "server/index.js.map"))
    ).rejects.toThrow("ENOENT");
    objects.delete(`test/compiled/${manifest.digest}/client/favicon.svg`);
    await expect(
      store.restore(manifest.digest, path.join(directory, "missing"))
    ).rejects.toThrow("Missing object");
  });

  it("does not certify conflicting retained bytes and rejects restoring over an existing directory", async () => {
    const { client, objects } = objectStore();
    const directory = await mkdtemp(
      path.join(tmpdir(), "quieter-compiled-conflict-")
    );
    directories.push(directory);
    await mkdir(path.join(directory, "server"));
    await mkdir(path.join(directory, "client"));
    await Promise.all([
      writeFile(
        path.join(directory, "server/wrangler.json"),
        JSON.stringify({
          compatibility_date: "2026-08-04",
          compatibility_flags: [],
        })
      ),
      writeFile(path.join(directory, "server/index.js"), "export default {}"),
    ]);
    const manifest = {
      ...(await inventoryWorkerArtifact(directory, "proof", "a".repeat(40))),
      archive: null,
    };
    const store = new ReleaseArtifactStore(client, "journal", "test");
    const key = `test/compiled/${manifest.digest}/server/index.js`;
    objects.set(key, {
      body: Buffer.from("export default []"),
      contentType: "application/javascript+module",
      etag: "conflict",
    });
    await expect(store.retain(manifest, directory)).rejects.toThrow(
      "bytes differ"
    );
    expect(
      objects.has(`test/compiled/${manifest.digest}/receipt.json`)
    ).toBeFalsy();
    objects.delete(key);
    await store.retain(manifest, directory);
    await expect(store.restore(manifest.digest, directory)).rejects.toThrow(
      "EEXIST"
    );
    await expect(
      readFile(path.join(directory, "server/index.js"), "utf-8")
    ).resolves.toBe("export default {}");
  });

  it("claims upload intents once and rejects conflicting completion receipts", async () => {
    const { client, objects } = objectStore();
    const store = new ObjectUploadStore(client, "journal", "test");
    const intent = {
      artifactDigest: "a".repeat(64),
      baseline: { id: randomUUID(), versionId: randomUUID() },
      createdAt: "2026-09-06T12:00:00.000Z",
      id: randomUUID(),
      scriptName: "probe",
      workflowRunId: "123",
    };
    const claims = await Promise.all([
      store.claim(intent),
      store.claim(intent),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await expect(store.receipt(intent.id)).resolves.toBeNull();
    const receipt = { intent, versionId: randomUUID() };
    await store.complete(receipt);
    await store.complete(receipt);
    await expect(
      store.complete({ ...receipt, versionId: randomUUID() })
    ).rejects.toThrow("Conflicting upload completion");
    await expect(
      store.complete({
        ...receipt,
        intent: { ...intent, artifactDigest: "b".repeat(64) },
      })
    ).rejects.toThrow("does not match");
    const key = `test/uploads/${intent.id}/intent.json`;
    objects.set(key, {
      body: Buffer.from(JSON.stringify({ ...intent, id: randomUUID() })),
      contentType: "application/json",
      etag: "corrupt",
    });
    await expect(store.read(intent.id)).rejects.toThrow("identity mismatch");
  });

  it("retains immutable manifests and detects missing archived bytes during release preflight", async () => {
    const { client, objects, writes } = objectStore();
    const { directory, manifest } = await build();
    const artifact = artifactSchema.parse({
      assetRouting: {},
      assets: manifest.files,
      buildId: manifest.buildId,
      compatibilityDate: "2026-08-04",
      compatibilityFlags: [],
      mainModule: "index.js",
      modules: [
        {
          bytes: 1,
          contentType: "application/javascript+module",
          digest: "a".repeat(64),
          path: "index.js",
        },
      ],
      schemaVersion: 1,
      sourceSha: "a".repeat(40),
    });
    const digest = createHash("sha256")
      .update(JSON.stringify(artifact))
      .digest("hex");
    const release = releaseArtifactSchema.parse({
      archive: { ...manifest, artifactDigest: digest },
      artifact,
      digest,
    });
    const archive = new AssetArchive(new S3ArchiveStore(client, "archive"));
    if (release.archive === null) {
      throw new Error("Expected browser archive.");
    }
    await archive.upload(directory, release.archive);
    const artifacts = new ReleaseArtifactStore(client, "journal", "test");
    await artifacts.write(release);
    await artifacts.write(release);
    expect(writes.filter((key) => key.includes("/artifacts/"))).toHaveLength(1);
    const preflight = new ReleasePreflight(artifacts, archive, {
      verifyArtifact: vi
        .fn<CloudflareRuntimeProvider["verifyArtifact"]>()
        .mockResolvedValue(),
    });
    const candidate = {
      id: "candidate",
      services: [
        {
          artifactDigest: digest,
          bindingGeneration: "b".repeat(64),
          contracts: [],
          requirements: {},
          scriptName: "web",
          service: "web",
          versionId: "f2a8db85-f29a-4148-9e85-22b214a427a9",
        },
      ],
      sourceSha: artifact.sourceSha,
    };
    await preflight.verify(candidate);
    objects.delete(manifest.files[0].path);
    await expect(preflight.verify(candidate)).rejects.toThrow("Missing object");
    const key = `test/artifacts/${digest}.json`;
    objects.set(key, {
      body: Buffer.from(JSON.stringify({ ...release, digest: "c".repeat(64) })),
      contentType: "application/json",
      etag: "corrupt",
    });
    await expect(artifacts.read(digest)).rejects.toThrow("identity differ");
    await expect(artifacts.write(release)).rejects.toThrow("identity differ");
  });

  it("archives nested assets and publishes the verified receipt last", async () => {
    const { client, objects, writes } = objectStore();
    const { directory, manifest } = await build();
    const archive = new AssetArchive(new S3ArchiveStore(client, "archive"));
    await archive.upload(directory, manifest);
    await archive.verify(manifest);
    expect(manifest.files.map((file) => file.path)).toStrictEqual([
      "assets/fonts/body-12345678.woff2",
      "assets/page-abcdefgh.js",
    ]);
    expect(writes.at(-1)).toBe(`receipts/${manifest.artifactDigest}.json`);
    expect(objects.has("assets/build-id.txt")).toBeFalsy();
    await archive.upload(directory, manifest);
    expect(writes).toHaveLength(3);
  });

  it("repairs a partial upload without replacing completed objects", async () => {
    const { client, objects, writes } = objectStore();
    const { directory, manifest } = await build();
    const [file] = manifest.files;
    objects.set(file.path, {
      body: await readFile(path.join(directory, file.path)),
      contentType: file.contentType,
      etag: "existing",
    });
    await new AssetArchive(new S3ArchiveStore(client, "archive")).upload(
      directory,
      manifest
    );
    expect(writes).toStrictEqual([
      "assets/page-abcdefgh.js",
      `receipts/${manifest.artifactDigest}.json`,
    ]);
  });

  it("refuses a hash collision and never writes its receipt", async () => {
    const { client, objects, writes } = objectStore();
    const { directory, manifest } = await build();
    const [file] = manifest.files;
    objects.set(file.path, {
      body: Buffer.alloc(file.bytes),
      contentType: file.contentType,
      etag: "conflict",
    });
    await expect(
      new AssetArchive(new S3ArchiveStore(client, "archive")).upload(
        directory,
        manifest
      )
    ).rejects.toThrow("checksum mismatch");
    expect(writes).toStrictEqual([]);
  });

  it("detects a missing object even when the receipt exists", async () => {
    const { client, objects } = objectStore();
    const { directory, manifest } = await build();
    const archive = new AssetArchive(new S3ArchiveStore(client, "archive"));
    await archive.upload(directory, manifest);
    objects.delete(manifest.files[0].path);
    await expect(archive.verify(manifest)).rejects.toThrow("Missing object");
  });

  it("rejects files changed after the build inventory", async () => {
    const { client, writes } = objectStore();
    const { directory, manifest } = await build();
    await writeFile(path.join(directory, manifest.files[0].path), "changed");
    await expect(
      new AssetArchive(new S3ArchiveStore(client, "archive")).upload(
        directory,
        manifest
      )
    ).rejects.toThrow("tested artifact");
    expect(writes).toStrictEqual([]);
  });

  it("keeps immutable checkpoints, rejects stale writers, and detects corruption", async () => {
    const { client, objects, writes } = objectStore();
    const journal = new ObjectReleaseJournal(client, "journal", "test");
    await expect(journal.read()).resolves.toBeNull();
    const state: ReleaseState = {
      attempt: null,
      healthy: {
        id: "baseline",
        services: [
          {
            artifactDigest: "a".repeat(64),
            bindingGeneration: "b".repeat(64),
            contracts: [],
            requirements: {},
            scriptName: "test",
            service: "test",
            versionId: "fa85f64f-5717-4562-b3fc-2c963f66afa6",
          },
        ],
        sourceSha: "a".repeat(40),
      },
      history: [],
      quarantinedArtifacts: [],
      schemaVersion: 1,
      stage: "test",
    };
    const first = await journal.write(null, state);
    const second = await journal.write(first.revision, state);
    await expect(journal.write(first.revision, state)).rejects.toThrow(
      "Precondition failed"
    );
    await expect(
      new ObjectReleaseJournal(client, "journal", "test").read()
    ).resolves.toStrictEqual(second);
    expect(writes.filter((key) => key.includes("checkpoints/"))).toHaveLength(
      3
    );
    const key = writes.at(2);
    if (key === undefined) {
      throw new Error("Missing checkpoint write.");
    }
    const checkpoint = objects.get(key);
    if (!checkpoint) {
      throw new Error("Missing checkpoint fixture.");
    }
    objects.set(key, { ...checkpoint, body: Buffer.from("corrupt") });
    await expect(journal.read()).rejects.toThrow("checksum mismatch");
  });
});
