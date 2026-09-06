import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { releaseArtifactSchema } from "./artifact.ts";
import type { ReleaseArtifact } from "./artifact.ts";
import { digestSchema, identifierSchema } from "./schema.ts";

export class ReleaseArtifactStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly stage: string;

  constructor(client: S3Client, bucket: string, stage: string) {
    this.client = client;
    this.bucket = bucket;
    this.stage = identifierSchema.parse(stage);
  }

  async read(digest: string) {
    const validated = digestSchema.parse(digest);
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${this.stage}/artifacts/${validated}.json`,
      })
    );
    if (
      !object.Body ||
      object.ContentType !== "application/json" ||
      object.ContentLength === undefined ||
      object.ContentLength > 8_000_000
    ) {
      throw new Error("Invalid retained release artifact.");
    }
    const manifest = releaseArtifactSchema.parse(
      JSON.parse(await object.Body.transformToString())
    );
    if (manifest.digest !== validated) {
      throw new Error("Retained artifact identity differs from the release.");
    }
    return manifest;
  }

  async write(input: ReleaseArtifact) {
    const manifest = releaseArtifactSchema.parse(input);
    const body = JSON.stringify(manifest);
    if (Buffer.byteLength(body) > 8_000_000) {
      throw new Error("Release artifact manifest exceeds the storage limit.");
    }
    await this.client
      .send(
        new PutObjectCommand({
          Body: body,
          Bucket: this.bucket,
          ContentType: "application/json",
          IfNoneMatch: "*",
          Key: `${this.stage}/artifacts/${manifest.digest}.json`,
        })
      )
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== "PreconditionFailed") {
          throw new Error("Cannot retain the release artifact manifest.");
        }
      });
    const stored = await this.read(manifest.digest);
    if (JSON.stringify(stored) !== body) {
      throw new Error(
        "Retained release artifact differs from the tested manifest."
      );
    }
  }
}
