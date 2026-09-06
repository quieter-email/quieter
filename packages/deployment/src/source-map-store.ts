import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { createSourceMapDestinationEnv } from "@quieter/env/deployment";
import type { z } from "zod";

import { releaseArtifactSchema } from "./artifact.ts";
import type { ReleaseArtifact } from "./artifact.ts";
import { sourceMapUploadReceiptSchema } from "./source-map-upload.ts";

type Receipt = z.infer<typeof sourceMapUploadReceiptSchema>;
type Destination = ReturnType<typeof createSourceMapDestinationEnv>;

export class SourceMapReceiptStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly destination: Destination;

  constructor(client: S3Client, bucket: string, destination: Destination) {
    this.client = client;
    this.bucket = bucket;
    this.destination = destination;
  }

  async retain(manifest: ReleaseArtifact, input: Receipt) {
    const receipt = sourceMapUploadReceiptSchema.parse(input);
    this.assertIdentity(manifest, receipt);
    await this.client
      .send(
        new PutObjectCommand({
          Body: JSON.stringify(receipt),
          Bucket: this.bucket,
          ContentType: "application/json",
          IfNoneMatch: "*",
          Key: `${this.destination.stage}/source-map-receipts/${manifest.digest}.json`,
        })
      )
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== "PreconditionFailed") {
          throw new Error(
            "Source-map receipt retention was not confirmed. Verify before continuing."
          );
        }
      });
    // An upload retry can have another attempt ID while certifying the same immutable pairs.
    return await this.verify(manifest);
  }

  async verify(input: ReleaseArtifact) {
    const manifest = releaseArtifactSchema.parse(input);
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${this.destination.stage}/source-map-receipts/${manifest.digest}.json`,
      })
    );
    if (
      !object.Body ||
      object.ContentType !== "application/json" ||
      object.ContentLength === undefined ||
      object.ContentLength > 4096
    ) {
      throw new Error("Invalid retained source-map processing receipt.");
    }
    const receipt = sourceMapUploadReceiptSchema.parse(
      JSON.parse(await object.Body.transformToString())
    );
    this.assertIdentity(manifest, receipt);
    return receipt;
  }

  private assertIdentity(input: ReleaseArtifact, receipt: Receipt) {
    const manifest = releaseArtifactSchema.parse(input);
    const files = [
      ...manifest.artifact.modules,
      ...manifest.artifact.assets,
    ].filter((file) => /\.(?:js|mjs|cjs)$/u.test(file.path));
    if (
      receipt.artifactDigest !== manifest.digest ||
      receipt.buildId !== manifest.artifact.buildId ||
      receipt.files !== files.length ||
      manifest.artifact.provenance?.stage !== this.destination.stage ||
      receipt.stage !== this.destination.stage ||
      receipt.organization !== this.destination.organization ||
      receipt.project !== this.destination.project ||
      receipt.url !== this.destination.url
    ) {
      throw new Error(
        "Source-map processing receipt does not match the release and destination."
      );
    }
  }
}
