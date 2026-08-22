import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { db } from "@quieter/database/client";
import { managedMailMessage } from "@quieter/database/schema";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";

const batchSize = Number(serverEnv.BACKFILL_BATCH_SIZE ?? 100);
const concurrency = Number(serverEnv.BACKFILL_CONCURRENCY ?? 5);
const sourceBucket = requireServerEnv("MAIL_BUCKET");
const targetBucket = requireServerEnv("R2_BUCKET");
const endpoint =
  serverEnv.R2_ENDPOINT ??
  `https://${requireServerEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
const awsRegion =
  serverEnv.AWS_REGION ?? serverEnv.AWS_DEFAULT_REGION ?? "eu-central-1";

const source = new S3Client({
  region: awsRegion,
});
const target = new S3Client({
  credentials: {
    accessKeyId: requireServerEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireServerEnv("R2_SECRET_ACCESS_KEY"),
  },
  endpoint,
  region: "auto",
});

const runLimited = async <T>(items: T[], task: (item: T) => Promise<void>) => {
  let nextIndex = 0;
  const runNext = async (): Promise<void> => {
    const currentIndex = nextIndex;
    nextIndex += 1;
    if (currentIndex >= items.length) {
      return;
    }

    const item = items[currentIndex];
    if (item !== undefined) {
      await task(item);
    }

    await runNext();
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      await runNext();
    })
  );
};

const copyMessage = async (message: { id: string; s3Key: string }) => {
  const object = await source.send(
    new GetObjectCommand({
      Bucket: sourceBucket,
      Key: message.s3Key,
    })
  );
  if (object.Body === undefined) {
    throw new Error(`S3 object ${message.s3Key} has no body.`);
  }

  const body = Buffer.from(await object.Body.transformToByteArray());
  await target.send(
    new PutObjectCommand({
      Body: body,
      Bucket: targetBucket,
      ContentLength: body.byteLength,
      ContentType: object.ContentType ?? "message/rfc822",
      Key: message.s3Key,
    })
  );
  await db
    .update(managedMailMessage)
    .set({
      rawObjectBucket: targetBucket,
      rawObjectKey: message.s3Key,
      rawObjectProvider: "r2",
      updatedAt: new Date(),
    })
    .where(eq(managedMailMessage.id, message.id));
};

const backfillBatch = async (
  cursor: string,
  total: number
): Promise<number> => {
  const messages = await db
    .select({
      id: managedMailMessage.id,
      s3Key: managedMailMessage.s3Key,
    })
    .from(managedMailMessage)
    .where(
      and(
        cursor === "" ? undefined : gt(managedMailMessage.id, cursor),
        isNull(managedMailMessage.rawObjectProvider),
        eq(managedMailMessage.s3Bucket, sourceBucket),
        isNotNull(managedMailMessage.s3Key)
      )
    )
    .orderBy(asc(managedMailMessage.id))
    .limit(batchSize);

  if (messages.length === 0) {
    return total;
  }

  const copyableMessages = messages.flatMap((message) =>
    message.s3Key !== null && message.s3Key !== ""
      ? [{ id: message.id, s3Key: message.s3Key }]
      : []
  );
  await runLimited(copyableMessages, copyMessage);
  const nextCursor = messages.at(-1)?.id ?? cursor;
  const nextTotal = total + messages.length;
  process.stdout.write(
    `Backfilled ${nextTotal} managed mail raw objects to R2.\n`
  );
  return await backfillBatch(nextCursor, nextTotal);
};

const total = await backfillBatch("", 0);

process.stdout.write(
  `Managed mail R2 backfill complete. Copied ${total} row references.\n`
);
