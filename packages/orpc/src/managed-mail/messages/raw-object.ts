import type { S3Client } from "@aws-sdk/client-s3";
import { serverEnv } from "@quieter/env/server";

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
  const region = serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION;
  if (!region) throw new Error("AWS_REGION or AWS_DEFAULT_REGION is required.");
  const { S3Client } = await import("@aws-sdk/client-s3");
  s3Client ??= new S3Client({ region });
  return s3Client;
};

const getR2Client = async () => {
  const endpoint =
    serverEnv.R2_ENDPOINT ||
    (serverEnv.R2_ACCOUNT_ID
      ? `https://${serverEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : null);
  if (
    !endpoint ||
    !serverEnv.R2_ACCESS_KEY_ID ||
    !serverEnv.R2_SECRET_ACCESS_KEY ||
    !serverEnv.R2_BUCKET
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
  record: RawMailObjectRecord,
): RawMailObjectReference | null => {
  if (record.rawObjectProvider && record.rawObjectBucket && record.rawObjectKey) {
    return {
      bucket: record.rawObjectBucket,
      key: record.rawObjectKey,
      provider: record.rawObjectProvider,
    };
  }
  if (record.s3Bucket && record.s3Key) {
    return { bucket: record.s3Bucket, key: record.s3Key, provider: "s3" };
  }
  return null;
};

const getRawMailObjectClient = (provider: RawMailObjectProvider) =>
  provider === "r2" ? getR2Client() : getS3Client();

export const readRawMailObject = async (record: RawMailObjectRecord) => {
  const object = getRawMailObjectReference(record);
  if (!object) throw new Error("The original message is unavailable.");
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await getRawMailObjectClient(object.provider);
  const response = await client.send(
    new GetObjectCommand({ Bucket: object.bucket, Key: object.key }),
  );
  if (!response.Body) throw new Error("The original message is unavailable.");
  return new Uint8Array(await response.Body.transformToByteArray());
};

export const deleteRawMailObject = async (object: RawMailObjectReference) => {
  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await getRawMailObjectClient(object.provider);
  await client.send(new DeleteObjectCommand({ Bucket: object.bucket, Key: object.key }));
};
