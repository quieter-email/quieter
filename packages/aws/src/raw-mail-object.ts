import {
  DeleteObjectCommand,
  PutObjectCommand,
  type DeleteObjectCommandInput,
  type PutObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";
import { serverEnv } from "@quieter/env/server";

export type RawMailObjectProvider = "r2" | "s3";

export type RawMailObjectReference = {
  bucket: string;
  key: string;
  provider: RawMailObjectProvider;
};

let r2Client: S3Client | null = null;
let s3Client: S3Client | null = null;

const getS3Client = () => {
  const region = serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION;
  if (!region) throw new Error("AWS_REGION or AWS_DEFAULT_REGION is required.");

  s3Client ??= new S3Client({ region });
  return s3Client;
};

const getR2Client = () => {
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
    throw new Error(
      "R2_ACCOUNT_ID or R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are required.",
    );
  }

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

export const getCanonicalRawMailProvider = (): RawMailObjectProvider =>
  serverEnv.R2_BUCKET ? "r2" : "s3";

export const getCanonicalRawMailBucket = (fallbackS3Bucket: string) =>
  getCanonicalRawMailProvider() === "r2" ? serverEnv.R2_BUCKET! : fallbackS3Bucket;

export const putRawMailObject = async (
  reference: RawMailObjectReference,
  input: Omit<PutObjectCommandInput, "Bucket" | "Key">,
) => {
  const command = new PutObjectCommand({
    ...input,
    Bucket: reference.bucket,
    Key: reference.key,
  });

  if (reference.provider === "r2") {
    await getR2Client().send(command);
    return;
  }

  await getS3Client().send(command);
};

export const deleteRawMailObject = async (reference: RawMailObjectReference) => {
  const input: DeleteObjectCommandInput = {
    Bucket: reference.bucket,
    Key: reference.key,
  };

  if (reference.provider === "r2") {
    await getR2Client().send(new DeleteObjectCommand(input));
    return;
  }

  await getS3Client().send(new DeleteObjectCommand(input));
};
