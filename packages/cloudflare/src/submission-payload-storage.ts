import { createHash } from "node:crypto";

import type { MailPayloadObject } from "@quieter/database/schema";
import type { SubmissionPayloadStorage } from "@quieter/orpc/mail-submission-payload";

const storageDeadline = async <T>(operation: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      // oxlint-disable-next-line promise/avoid-new -- Native R2 operations do not accept an abort signal.
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Submission storage deadline exceeded."));
        }, 10_000);
      }),
    ]);
  } catch {
    throw new Error("Submission storage operation failed.");
  } finally {
    clearTimeout(timer);
  }
};

export class R2SubmissionPayloadStorage implements SubmissionPayloadStorage {
  private readonly bucket: Pick<R2Bucket, "get" | "put" | "delete">;

  constructor(bucket: Pick<R2Bucket, "get" | "put" | "delete">) {
    this.bucket = bucket;
  }

  async write(object: MailPayloadObject, bytes: Uint8Array): Promise<void> {
    if (
      !/^submissions\/[a-f\d-]{36}\/\d{1,2}-[a-f\d]{64}$/u.test(object.key) ||
      bytes.byteLength !== object.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== object.digest
    ) {
      throw new Error("Invalid submission object.");
    }
    await storageDeadline(
      this.bucket.put(object.key, bytes, {
        httpMetadata: { contentType: "application/octet-stream" },
        onlyIf: { etagDoesNotMatch: "*" },
        sha256: object.digest,
      })
    );
  }

  async read(object: MailPayloadObject): Promise<Uint8Array> {
    if (
      !/^submissions\/[a-f\d-]{36}\/\d{1,2}-[a-f\d]{64}$/u.test(object.key) ||
      !Number.isSafeInteger(object.bytes) ||
      object.bytes < 1 ||
      object.bytes > 25 * 1024 * 1024
    ) {
      throw new Error("Invalid submission object.");
    }
    const stored = await storageDeadline(this.bucket.get(object.key));
    if (stored === null || stored.size !== object.bytes) {
      throw new Error(
        "Submission object is missing or has an unexpected size."
      );
    }
    const bytes = new Uint8Array(await storageDeadline(stored.arrayBuffer()));
    if (createHash("sha256").update(bytes).digest("hex") !== object.digest) {
      throw new Error("Submission object checksum differs from its manifest.");
    }
    return bytes;
  }

  async remove(key: string): Promise<void> {
    if (!/^submissions\/[a-f\d-]{36}\/\d{1,2}-[a-f\d]{64}$/u.test(key)) {
      throw new Error("Invalid submission cleanup object.");
    }
    await storageDeadline(this.bucket.delete(key));
  }
}
