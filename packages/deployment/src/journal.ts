import { createHash, randomUUID } from "node:crypto";

import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

import {
  digestSchema,
  identifierSchema,
  releaseStateSchema,
} from "./schema.ts";
import type { Checkpoint, ReleaseJournal, ReleaseState } from "./schema.ts";

const indexSchema = z.strictObject({
  digest: digestSchema,
  key: z.string().regex(/^checkpoints\/[\w-]+\.json$/u),
});

export class ObjectReleaseJournal implements ReleaseJournal {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly stage: string;

  constructor(client: S3Client, bucket: string, stage: string) {
    this.client = client;
    this.bucket = bucket;
    this.stage = identifierSchema.parse(stage);
  }

  async read(): Promise<Checkpoint | null> {
    const object = await this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: `${this.stage}/current.json`,
        })
      )
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "NoSuchKey") {
          return null;
        }
        throw new Error("Could not read the release journal.");
      });
    if (!object) {
      return null;
    }
    if (
      !object.Body ||
      object.ETag === undefined ||
      object.ETag === "" ||
      (object.ContentLength ?? 0) > 4096
    ) {
      throw new Error("Invalid release journal index.");
    }
    const index = indexSchema.parse(
      JSON.parse(await object.Body.transformToString())
    );
    const snapshot = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${this.stage}/${index.key}`,
      })
    );
    if (!snapshot.Body || (snapshot.ContentLength ?? 0) > 2_000_000) {
      throw new Error("Invalid release journal checkpoint.");
    }
    const body = await snapshot.Body.transformToString();
    if (createHash("sha256").update(body).digest("hex") !== index.digest) {
      throw new Error("Release journal checkpoint checksum mismatch.");
    }
    const state = releaseStateSchema.parse(JSON.parse(body));
    if (state.stage !== this.stage) {
      throw new Error("Release journal stage mismatch.");
    }
    return { revision: object.ETag, state };
  }

  async write(
    revision: string | null,
    state: ReleaseState
  ): Promise<Checkpoint> {
    const validated = releaseStateSchema.parse(state);
    if (validated.stage !== this.stage) {
      throw new Error("Cannot write a different stage's release state.");
    }
    const body = JSON.stringify(validated);
    if (Buffer.byteLength(body) > 2_000_000) {
      throw new Error("Release history exceeded its bounded checkpoint size.");
    }
    const index = {
      digest: createHash("sha256").update(body).digest("hex"),
      key: `checkpoints/${randomUUID()}.json`,
    };
    await this.client.send(
      new PutObjectCommand({
        Body: body,
        Bucket: this.bucket,
        ContentType: "application/json",
        IfNoneMatch: "*",
        Key: `${this.stage}/${index.key}`,
      })
    );
    const result = await this.client.send(
      new PutObjectCommand({
        Body: JSON.stringify(index),
        Bucket: this.bucket,
        ContentType: "application/json",
        ...(revision === null ? { IfNoneMatch: "*" } : { IfMatch: revision }),
        Key: `${this.stage}/current.json`,
      })
    );
    if (result.ETag === undefined || result.ETag === "") {
      throw new Error(
        "The journal write has an uncertain outcome. Re-read before continuing."
      );
    }
    return { revision: result.ETag, state: validated };
  }
}
