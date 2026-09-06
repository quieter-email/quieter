import { createHash, randomUUID } from "node:crypto";

import { env } from "cloudflare:workers";
import { describe, expect, test } from "vite-plus/test";

import { R2SubmissionPayloadStorage } from "../src/submission-payload-storage.ts";

describe("native submission payload storage", () => {
  test("retains immutable bytes and rejects corruption through the real R2 binding", async () => {
    const storage = new R2SubmissionPayloadStorage(env.LocalMailStorage);
    const bytes = new TextEncoder().encode("private fixture");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const object = {
      bytes: bytes.byteLength,
      digest,
      key: `submissions/${randomUUID()}/0-${digest}`,
    };
    await storage.write(object, bytes);
    await storage.write(object, bytes);
    await expect(storage.read(object)).resolves.toStrictEqual(bytes);
    await env.LocalMailStorage.put(
      object.key,
      new Uint8Array(bytes.byteLength)
    );
    await storage.write(object, bytes);
    await expect(storage.read(object)).rejects.toThrow("checksum differs");
    await storage.remove(object.key);
    await expect(storage.read(object)).rejects.toThrow("missing");
  });

  test("restricts all operations to server-created submission keys", async () => {
    const storage = new R2SubmissionPayloadStorage(env.LocalMailStorage);
    const bytes = new Uint8Array([1]);
    const object = {
      bytes: 1,
      digest: createHash("sha256").update(bytes).digest("hex"),
      key: "fixtures/private.eml",
    };
    await expect(storage.write(object, bytes)).rejects.toThrow(
      "Invalid submission object"
    );
    await expect(storage.read(object)).rejects.toThrow(
      "Invalid submission object"
    );
    await expect(storage.remove(object.key)).rejects.toThrow(
      "Invalid submission cleanup object"
    );
  });
});
