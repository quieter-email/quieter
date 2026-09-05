import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AssetArchive, inventoryAssets } from "../src/assets.ts";
import { ObjectReleaseJournal } from "../src/journal.ts";
import type { ReleaseState } from "../src/schema.ts";

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
  it("archives nested assets and publishes the verified receipt last", async () => {
    const { client, objects, writes } = objectStore();
    const { directory, manifest } = await build();
    const archive = new AssetArchive(client, "archive");
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
    await new AssetArchive(client, "archive").upload(directory, manifest);
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
      new AssetArchive(client, "archive").upload(directory, manifest)
    ).rejects.toThrow("checksum mismatch");
    expect(writes).toStrictEqual([]);
  });

  it("detects a missing object even when the receipt exists", async () => {
    const { client, objects } = objectStore();
    const { directory, manifest } = await build();
    const archive = new AssetArchive(client, "archive");
    await archive.upload(directory, manifest);
    objects.delete(manifest.files[0].path);
    await expect(archive.verify(manifest)).rejects.toThrow("Missing object");
  });

  it("rejects files changed after the build inventory", async () => {
    const { client, writes } = objectStore();
    const { directory, manifest } = await build();
    await writeFile(path.join(directory, manifest.files[0].path), "changed");
    await expect(
      new AssetArchive(client, "archive").upload(directory, manifest)
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
