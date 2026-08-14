import type { S3Client } from "@aws-sdk/client-s3";
import { serverEnv } from "@quieter/env/server";

import { hasText } from "../../text";

export type RawMailObjectProvider = "r2" | "s3";

export type RawMailObjectReference = {
  bucket: string;
  key: string;
  provider: RawMailObjectProvider;
};

type RawMailObjectRecord = {
  rawObjectBucket: string | null;
  rawObjectKey: string | null;
  rawObjectProvider: RawMailObjectProvider | null;
  s3Bucket: string | null;
  s3Key: string | null;
};

let r2Client: S3Client | null = null;
let s3Client: S3Client | null = null;

const getS3Client = async () => {
  const region = serverEnv.AWS_REGION ?? serverEnv.AWS_DEFAULT_REGION;
  if (!hasText(region)) {
    throw new Error("AWS_REGION or AWS_DEFAULT_REGION is required.");
  }
  const { S3Client } = await import("@aws-sdk/client-s3");
  s3Client ??= new S3Client({ region });
  return s3Client;
};

const getR2Client = async () => {
  const endpoint =
    serverEnv.R2_ENDPOINT ??
    (hasText(serverEnv.R2_ACCOUNT_ID)
      ? `https://${serverEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : null);
  if (
    !hasText(endpoint) ||
    !hasText(serverEnv.R2_ACCESS_KEY_ID) ||
    !hasText(serverEnv.R2_SECRET_ACCESS_KEY) ||
    !hasText(serverEnv.R2_BUCKET)
  ) {
    throw new Error("R2 raw mail storage is not configured.");
  }

  const { S3Client } = await import("@aws-sdk/client-s3");
  r2Client ??= new S3Client({
    credentials: {
      accessKeyId: serverEnv.R2_ACCESS_KEY_ID,
      secretAccessKey: serverEnv.R2_SECRET_ACCESS_KEY,
    },
    endpoint,
    region: "auto",
  });
  return r2Client;
};

export const getRawMailObjectReference = (
  record: RawMailObjectRecord
): RawMailObjectReference | null => {
  if (
    hasText(record.rawObjectProvider) &&
    hasText(record.rawObjectBucket) &&
    hasText(record.rawObjectKey)
  ) {
    return {
      bucket: record.rawObjectBucket,
      key: record.rawObjectKey,
      provider: record.rawObjectProvider,
    };
  }
  if (hasText(record.s3Bucket) && hasText(record.s3Key)) {
    return { bucket: record.s3Bucket, key: record.s3Key, provider: "s3" };
  }
  return null;
};

const getRawMailObjectClient = async (provider: RawMailObjectProvider) =>
  provider === "r2" ? await getR2Client() : await getS3Client();

export const readRawMailObject = async (record: RawMailObjectRecord) => {
  const object = getRawMailObjectReference(record);
  if (object === null) {
    throw new Error("The original message is unavailable.");
  }
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await getRawMailObjectClient(object.provider);
  const response = await client.send(
    new GetObjectCommand({ Bucket: object.bucket, Key: object.key })
  );
  if (response.Body === undefined) {
    throw new Error("The original message is unavailable.");
  }
  return new Uint8Array(await response.Body.transformToByteArray());
};

export const deleteRawMailObject = async (object: RawMailObjectReference) => {
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await getRawMailObjectClient(object.provider);
  await client.send(
    new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key })
  );
};
