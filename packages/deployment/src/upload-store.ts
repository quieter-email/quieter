import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import { identifierSchema } from "./schema.ts";
import { uploadIntentSchema, uploadReceiptSchema } from "./upload.ts";
import type { UploadIntent, UploadReceipt, UploadStore } from "./upload.ts";

export class ObjectUploadStore implements UploadStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly stage: string;

  constructor(client: S3Client, bucket: string, stage: string) {
    this.client = client;
    this.bucket = bucket;
    this.stage = identifierSchema.parse(stage);
  }

  async claim(input: UploadIntent) {
    const intent = uploadIntentSchema.parse(input);
    return await this.create(`${intent.id}/intent`, intent);
  }

  async read(id: string) {
    z.uuid().parse(id);
    const intent = uploadIntentSchema.parse(await this.get(`${id}/intent`));
    if (intent.id !== id) {
      throw new Error("Retained upload identity mismatch.");
    }
    return intent;
  }

  async receipt(id: string) {
    z.uuid().parse(id);
    const object = await this.get(`${id}/receipt`);
    if (object === null) {
      return null;
    }
    const receipt = uploadReceiptSchema.parse(object);
    if (receipt.intent.id !== id) {
      throw new Error("Retained upload receipt identity mismatch.");
    }
    return receipt;
  }

  async complete(input: UploadReceipt) {
    const receipt = uploadReceiptSchema.parse(input);
    const intent = await this.read(receipt.intent.id);
    if (JSON.stringify(intent) !== JSON.stringify(receipt.intent)) {
      throw new Error("Upload receipt does not match the claimed intent.");
    }
    await this.create(`${intent.id}/receipt`, receipt);
    const stored = await this.receipt(intent.id);
    if (JSON.stringify(stored) !== JSON.stringify(receipt)) {
      throw new Error(
        "Conflicting upload completion. Reconcile before continuing."
      );
    }
  }

  private async create(key: string, value: UploadIntent | UploadReceipt) {
    try {
      await this.client.send(
        new PutObjectCommand({
          Body: JSON.stringify(value),
          Bucket: this.bucket,
          ContentType: "application/json",
          IfNoneMatch: "*",
          Key: `${this.stage}/uploads/${key}.json`,
        })
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "PreconditionFailed") {
        return false;
      }
      throw new Error(
        "Upload journal write has an uncertain outcome. Reconcile before continuing.",
        { cause: error }
      );
    }
  }

  private async get(key: string): Promise<unknown> {
    const object = await this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: `${this.stage}/uploads/${key}.json`,
        })
      )
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "NoSuchKey") {
          return null;
        }
        throw new Error("Could not read the upload journal.");
      });
    if (object === null) {
      return null;
    }
    if (
      !object.Body ||
      object.ContentType !== "application/json" ||
      object.ContentLength === undefined ||
      object.ContentLength > 8192
    ) {
      throw new Error("Invalid upload journal object.");
    }
    return JSON.parse(await object.Body.transformToString());
  }
}
