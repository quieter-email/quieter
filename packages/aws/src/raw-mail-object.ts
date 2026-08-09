import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  DeleteObjectCommandInput,
  PutObjectCommandInput,
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
  const region = serverEnv.AWS_REGION ?? serverEnv.AWS_DEFAULT_REGION;
  if (region === null || region === undefined || region === "") {
    throw new Error("AWS_REGION or AWS_DEFAULT_REGION is required.");
  }

  s3Client ??= new S3Client({ region });
  return s3Client;
};

const getR2Endpoint = () => {
  if (
    serverEnv.R2_ENDPOINT !== null &&
    serverEnv.R2_ENDPOINT !== undefined &&
    serverEnv.R2_ENDPOINT !== ""
  ) {
    return serverEnv.R2_ENDPOINT;
  }

  if (
    serverEnv.R2_ACCOUNT_ID !== null &&
    serverEnv.R2_ACCOUNT_ID !== undefined &&
    serverEnv.R2_ACCOUNT_ID !== ""
  ) {
    return `https://${serverEnv.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }

  return null;
};

const getR2Client = () => {
  const endpoint = getR2Endpoint();
  const accessKeyId = serverEnv.R2_ACCESS_KEY_ID;
  const secretAccessKey = serverEnv.R2_SECRET_ACCESS_KEY;
  const bucket = serverEnv.R2_BUCKET;
  if (
    endpoint === null ||
    accessKeyId === null ||
    accessKeyId === undefined ||
    accessKeyId === "" ||
    secretAccessKey === null ||
    secretAccessKey === undefined ||
    secretAccessKey === "" ||
    bucket === null ||
    bucket === undefined ||
    bucket === ""
  ) {
    throw new Error(
      "R2_ACCOUNT_ID or R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET are required."
    );
  }

  r2Client ??= new S3Client({
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    endpoint,
    region: "auto",
  });
  return r2Client;
};

export const getCanonicalRawMailProvider = (): RawMailObjectProvider =>
  serverEnv.R2_BUCKET !== null &&
  serverEnv.R2_BUCKET !== undefined &&
  serverEnv.R2_BUCKET !== ""
    ? "r2"
    : "s3";

export const getCanonicalRawMailBucket = (fallbackS3Bucket: string) => {
  const provider = getCanonicalRawMailProvider();
  if (provider === "r2") {
    const bucket = serverEnv.R2_BUCKET;
    if (bucket === null || bucket === undefined || bucket === "") {
      throw new Error("R2_BUCKET is required for canonical R2 storage.");
    }
    return bucket;
  }

  return fallbackS3Bucket;
};

export const putRawMailObject = async (
  reference: RawMailObjectReference,
  input: Omit<PutObjectCommandInput, "Bucket" | "Key">
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

export const deleteRawMailObject = async (
  reference: RawMailObjectReference
) => {
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
