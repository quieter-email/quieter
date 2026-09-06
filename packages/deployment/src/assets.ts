import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { digestSchema, identifierSchema } from "./schema.ts";

export const assetPathPattern =
  /^assets\/(?:[\w-]+\/)*[\w.-]+-[\w-]{8,}\.(?:avif|css|gif|ico|jpeg|jpg|js|png|svg|webp|woff|woff2)$/u;
const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export const assetManifestSchema = z
  .strictObject({
    artifactDigest: digestSchema,
    buildId: identifierSchema,
    files: z
      .array(
        z.strictObject({
          bytes: z.number().int().min(0).max(25_000_000),
          contentType: z.enum(Object.values(contentTypes)),
          digest: digestSchema,
          path: z.string().regex(assetPathPattern),
        })
      )
      .min(1)
      .max(20_000),
    schemaVersion: z.literal(1),
  })
  .superRefine((manifest, context) => {
    if (
      new Set(manifest.files.map((file) => file.path)).size !==
      manifest.files.length
    ) {
      context.addIssue({ code: "custom", message: "Duplicate asset paths." });
    }
  });

export type AssetManifest = z.infer<typeof assetManifestSchema>;

export const inventoryAssets = async (
  clientDirectory: string,
  buildId: string,
  artifactDigest: string
) => {
  const files: AssetManifest["files"] = [];
  const pending = ["assets"];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) {
      break;
    }
    // oxlint-disable-next-line no-await-in-loop -- Bound filesystem traversal and reject symlinks.
    const entries = await readdir(path.join(clientDirectory, directory), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error("Asset artifacts must not contain symlinks.");
      }
      if (entry.isDirectory()) {
        if (!/^[\w-]+$/u.test(entry.name)) {
          throw new Error("Unsupported asset directory.");
        }
        pending.push(relative);
        continue;
      }
      if (relative === "assets/build-id.txt" || relative.endsWith(".map")) {
        continue;
      }
      if (!entry.isFile() || !assetPathPattern.test(relative)) {
        throw new Error(
          `Asset is not an eligible immutable browser file: ${relative}`
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- Bound memory to one asset while hashing.
      const body = await readFile(path.join(clientDirectory, relative));
      files.push({
        bytes: body.byteLength,
        contentType: contentTypes[path.extname(relative)],
        digest: createHash("sha256").update(body).digest("hex"),
        path: relative,
      });
    }
  }
  return assetManifestSchema.parse({
    artifactDigest,
    buildId,
    files: files.toSorted((a, b) => a.path.localeCompare(b.path)),
    schemaVersion: 1,
  });
};

export type ArchiveStore = {
  create: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  read: (
    key: string,
    expectedBytes: number
  ) => Promise<{ body: Uint8Array; contentType: string | undefined }>;
};

export class AssetArchive {
  private readonly store: ArchiveStore;

  constructor(store: ArchiveStore) {
    this.store = store;
  }

  async upload(clientDirectory: string, manifest: AssetManifest) {
    const validated = assetManifestSchema.parse(manifest);
    for (const file of validated.files) {
      // oxlint-disable-next-line no-await-in-loop -- Bound memory and API pressure; repairs reuse exact artifact bytes.
      const body = await readFile(path.join(clientDirectory, file.path));
      if (
        body.byteLength !== file.bytes ||
        createHash("sha256").update(body).digest("hex") !== file.digest
      ) {
        throw new Error("The archived build differs from the tested artifact.");
      }
      // oxlint-disable-next-line no-await-in-loop -- Never overwrite an existing hashed URL, including on reruns.
      await this.store.create(file.path, body, file.contentType);
      // oxlint-disable-next-line no-await-in-loop -- Read back bytes and MIME before publishing a receipt.
      await this.verifyObject(
        file.path,
        file.digest,
        file.bytes,
        file.contentType
      );
    }
    const body = Buffer.from(JSON.stringify(validated));
    const digest = createHash("sha256").update(body).digest("hex");
    const key = `receipts/${validated.artifactDigest}.json`;
    await this.store.create(key, body, "application/json");
    await this.verifyObject(key, digest, body.byteLength, "application/json");
    return digest;
  }

  async verify(manifest: AssetManifest) {
    const validated = assetManifestSchema.parse(manifest);
    const body = Buffer.from(JSON.stringify(validated));
    await this.verifyObject(
      `receipts/${validated.artifactDigest}.json`,
      createHash("sha256").update(body).digest("hex"),
      body.byteLength,
      "application/json"
    );
    for (const file of validated.files) {
      // oxlint-disable-next-line no-await-in-loop -- A receipt alone cannot establish that all referenced objects still exist.
      await this.verifyObject(
        file.path,
        file.digest,
        file.bytes,
        file.contentType
      );
    }
  }

  private async verifyObject(
    key: string,
    digest: string,
    bytes: number,
    contentType: string
  ) {
    const object = await this.store.read(key, bytes);
    if (
      object.body.byteLength !== bytes ||
      object.contentType !== contentType
    ) {
      throw new Error("Asset archive size or content type mismatch.");
    }
    const { body } = object;
    if (createHash("sha256").update(body).digest("hex") !== digest) {
      throw new Error(
        "Asset archive checksum mismatch. Refusing to overwrite existing bytes."
      );
    }
  }
}
