import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { readArtifactFile, releaseArtifactSchema } from "./artifact.ts";
import type { ReleaseArtifact, WorkerArtifact } from "./artifact.ts";
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

  async retain(input: ReleaseArtifact, directory: string) {
    const manifest = releaseArtifactSchema.parse(input);
    const files = [
      ...manifest.artifact.modules.map((file) => ({
        file,
        root: ["_headers", "_redirects"].includes(file.path)
          ? "client"
          : "server",
      })),
      ...manifest.artifact.assets.map((file) => ({ file, root: "client" })),
    ];
    for (let offset = 0; offset < files.length; offset += 5) {
      // oxlint-disable-next-line no-await-in-loop -- Bound concurrent immutable uploads and verification reads.
      await Promise.all(
        files.slice(offset, offset + 5).map(async ({ file, root }) => {
          const body = await readArtifactFile(path.join(directory, root), file);
          const key = `${this.stage}/compiled/${manifest.digest}/${root}/${file.path}`;
          await this.client
            .send(
              new PutObjectCommand({
                Body: body,
                Bucket: this.bucket,
                ContentType: file.contentType,
                IfNoneMatch: "*",
                Key: key,
              })
            )
            .catch((error: unknown) => {
              if (
                !(error instanceof Error) ||
                error.name !== "PreconditionFailed"
              ) {
                throw new Error("Could not retain compiled release bytes.");
              }
            });
          await this.readCompiledFile(key, file);
        })
      );
    }
    await this.write(manifest);
    const receipt = JSON.stringify({
      artifactDigest: manifest.digest,
      schemaVersion: 1,
    });
    await this.client
      .send(
        new PutObjectCommand({
          Body: receipt,
          Bucket: this.bucket,
          ContentType: "application/json",
          IfNoneMatch: "*",
          Key: `${this.stage}/compiled/${manifest.digest}/receipt.json`,
        })
      )
      .catch((error: unknown) => {
        if (!(error instanceof Error) || error.name !== "PreconditionFailed") {
          throw new Error(
            "Compiled retention receipt has an uncertain outcome. Verify before continuing."
          );
        }
      });
    await this.verifyCompiledReceipt(manifest.digest);
  }

  async restore(digest: string, directory: string) {
    const manifest = await this.read(digest);
    await this.verifyCompiledReceipt(manifest.digest);
    // Refuse an existing destination so restoring never overwrites a checkout or another build.
    await mkdir(directory);
    const files = [
      ...manifest.artifact.modules.map((file) => ({
        file,
        root: ["_headers", "_redirects"].includes(file.path)
          ? "client"
          : "server",
      })),
      ...manifest.artifact.assets.map((file) => ({ file, root: "client" })),
    ];
    for (let offset = 0; offset < files.length; offset += 5) {
      // oxlint-disable-next-line no-await-in-loop -- Restore only bounded verified batches into the fresh directory.
      await Promise.all(
        files.slice(offset, offset + 5).map(async ({ file, root }) => {
          const body = await this.readCompiledFile(
            `${this.stage}/compiled/${manifest.digest}/${root}/${file.path}`,
            file
          );
          const destination = path.join(directory, root, file.path);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, body, { flag: "wx" });
        })
      );
    }
    return manifest;
  }

  private async verifyCompiledReceipt(digest: string) {
    const object = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: `${this.stage}/compiled/${digest}/receipt.json`,
      })
    );
    if (
      !object.Body ||
      object.ContentType !== "application/json" ||
      object.ContentLength === undefined ||
      object.ContentLength > 512 ||
      (await object.Body.transformToString()) !==
        JSON.stringify({ artifactDigest: digest, schemaVersion: 1 })
    ) {
      throw new Error("Invalid compiled release retention receipt.");
    }
  }

  private async readCompiledFile(
    key: string,
    file: WorkerArtifact["modules"][number]
  ) {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    if (
      !object.Body ||
      object.ContentLength !== file.bytes ||
      object.ContentType !== file.contentType
    ) {
      throw new Error(
        "Retained compiled file metadata differs from the tested artifact."
      );
    }
    const body = Buffer.from(await object.Body.transformToByteArray());
    if (
      body.byteLength !== file.bytes ||
      createHash("sha256").update(body).digest("hex") !== file.digest
    ) {
      throw new Error(
        "Retained compiled bytes differ from the tested artifact."
      );
    }
    return body;
  }
}
