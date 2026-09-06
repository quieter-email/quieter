import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import { releaseArtifactSchema } from "./artifact.ts";
import type { ReleaseArtifact } from "./artifact.ts";
import { digestSchema, identifierSchema } from "./schema.ts";
import { trustedBuildSchema } from "./trusted-build.ts";
import type { TrustedBuild } from "./trusted-build.ts";

const receiptSchema = z.strictObject({
  artifactDigest: digestSchema,
  build: trustedBuildSchema,
  schemaVersion: z.literal(1),
});

export class TrustedBuildReceiptStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly stage: string;
  private readonly repository: string;

  constructor(
    client: S3Client,
    bucket: string,
    stage: string,
    repository: string
  ) {
    this.client = client;
    this.bucket = bucket;
    this.stage = identifierSchema.parse(stage);
    this.repository = z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/u)
      .parse(repository);
  }

  async retain(manifest: ReleaseArtifact, build: TrustedBuild) {
    const receipt = receiptSchema.parse({
      artifactDigest: manifest.digest,
      build,
      schemaVersion: 1,
    });
    this.assertIdentity(manifest, receipt);
    try {
      await this.client.send(
        new PutObjectCommand({
          Body: JSON.stringify(receipt),
          Bucket: this.bucket,
          ContentType: "application/json",
          IfNoneMatch: "*",
          Key: `${this.stage}/trusted-build-receipts/${manifest.digest}.json`,
        })
      );
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "PreconditionFailed") {
        throw new Error("Trusted build receipt retention was not confirmed.", {
          cause: error,
        });
      }
    }
    return await this.verify(manifest);
  }

  async verify(input: ReleaseArtifact) {
    const manifest = releaseArtifactSchema.parse(input);
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${this.stage}/trusted-build-receipts/${manifest.digest}.json`,
      })
    );
    if (
      !object.Body ||
      object.ContentType !== "application/json" ||
      object.ContentLength === undefined ||
      object.ContentLength > 4096
    ) {
      throw new Error("Invalid retained trusted build receipt.");
    }
    const receipt = receiptSchema.parse(
      JSON.parse(await object.Body.transformToString())
    );
    this.assertIdentity(manifest, receipt);
    return receipt;
  }

  private assertIdentity(
    input: ReleaseArtifact,
    receipt: z.infer<typeof receiptSchema>
  ) {
    const manifest = releaseArtifactSchema.parse(input);
    const { provenance } = manifest.artifact;
    const { build } = receipt;
    if (
      provenance === undefined ||
      (provenance.service ?? "web") !== (build.service ?? "web") ||
      receipt.artifactDigest !== manifest.digest ||
      build.sourceSha !== manifest.artifact.sourceSha ||
      build.stage !== this.stage ||
      provenance.stage !== this.stage ||
      build.repository !== this.repository ||
      build.sourceTree !== provenance.sourceTree ||
      build.lockfileDigest !== provenance.lockfileDigest ||
      build.publicConfigurationDigest !== provenance.publicConfigurationDigest
    ) {
      throw new Error(
        "Trusted build receipt does not match the retained artifact and destination."
      );
    }
  }
}
