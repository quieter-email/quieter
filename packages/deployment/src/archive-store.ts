import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

import type { ArchiveStore } from "./assets.ts";

export class S3ArchiveStore implements ArchiveStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(client: S3Client, bucket: string) {
    this.client = client;
    this.bucket = bucket;
  }

  async create(key: string, body: Uint8Array, contentType: string) {
    await this.client
      .send(
        new PutObjectCommand({
          Body: body,
          Bucket: this.bucket,
          CacheControl: "public, max-age=31536000, immutable",
          ContentType: contentType,
          IfNoneMatch: "*",
          Key: key,
        })
      )
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== "PreconditionFailed") {
          throw new Error(
            "Asset archive upload failed; traffic must remain unchanged."
          );
        }
      });
  }

  async read(key: string, expectedBytes: number) {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    if (!object.Body || object.ContentLength !== expectedBytes) {
      throw new Error("Asset archive size or content type mismatch.");
    }
    return {
      body: await object.Body.transformToByteArray(),
      contentType: object.ContentType,
    };
  }
}
