import type { R2Bucket } from "@cloudflare/workers-types";

import type { ArchiveStore } from "./assets.ts";

export class R2ArchiveStore implements ArchiveStore {
  private readonly bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async create(key: string, body: Uint8Array, contentType: string) {
    await R2ArchiveStore.request(
      this.bucket.put(key, new Uint8Array(body), {
        httpMetadata: {
          cacheControl: "public, max-age=31536000, immutable",
          contentType,
        },
        onlyIf: { etagDoesNotMatch: "*" },
      }),
      key
    );
  }

  async read(key: string, expectedBytes: number) {
    const object = await R2ArchiveStore.request(this.bucket.get(key), key);
    if (!object || object.size !== expectedBytes) {
      await object?.body.cancel();
      throw new Error("Asset archive size or content type mismatch.");
    }
    return {
      body: new Uint8Array(
        await R2ArchiveStore.request(object.arrayBuffer(), key)
      ),
      contentType: object.httpMetadata?.contentType,
    };
  }

  private static async request<T>(operation: Promise<T>, key: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // oxlint-disable-next-line promise/avoid-new -- Native R2 binding methods have no AbortSignal; callers dispose the proxy on failure.
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Archive operation timed out for ${key}.`));
      }, 30_000);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
