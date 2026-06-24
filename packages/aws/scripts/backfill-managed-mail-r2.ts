import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db, managedMailMessage } from "@quieter/database";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { and, asc, eq, gt, isNotNull, isNull } from "drizzle-orm";

const batchSize = Number(process.env.BACKFILL_BATCH_SIZE ?? 100);
const concurrency = Number(process.env.BACKFILL_CONCURRENCY ?? 5);
const sourceBucket = requireServerEnv("MAIL_BUCKET");
const targetBucket = requireServerEnv("R2_BUCKET");
const endpoint =
  serverEnv.R2_ENDPOINT || `https://${requireServerEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;

const source = new S3Client({
  region: serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION,
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
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        if (item) await task(item);
      }
    }),
  );
};

const copyMessage = async (message: { id: string; s3Key: string }) => {
  const object = await source.send(
    new GetObjectCommand({
      Bucket: sourceBucket,
      Key: message.s3Key,
    }),
  );
  if (!object.Body) {
    throw new Error(`S3 object ${message.s3Key} has no body.`);
  }

  const body = Buffer.from(await object.Body.transformToByteArray());
  await target.send(
    new PutObjectCommand({
      Body: body,
      Bucket: targetBucket,
      ContentLength: body.byteLength,
      ContentType: object.ContentType || "message/rfc822",
      Key: message.s3Key,
    }),
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

let cursor = "";
let total = 0;

for (;;) {
  const messages = await db
    .select({
      id: managedMailMessage.id,
      s3Key: managedMailMessage.s3Key,
    })
    .from(managedMailMessage)
    .where(
      and(
        cursor ? gt(managedMailMessage.id, cursor) : undefined,
        isNull(managedMailMessage.rawObjectProvider),
        eq(managedMailMessage.s3Bucket, sourceBucket),
        isNotNull(managedMailMessage.s3Key),
      ),
    )
    .orderBy(asc(managedMailMessage.id))
    .limit(batchSize);

  if (messages.length === 0) break;

  await runLimited(
    messages.flatMap((message) => (message.s3Key ? [{ ...message, s3Key: message.s3Key }] : [])),
    copyMessage,
  );
  cursor = messages[messages.length - 1]?.id ?? cursor;
  total += messages.length;
  console.info(`Backfilled ${total} managed mail raw objects to R2.`);
}

console.info(`Managed mail R2 backfill complete. Copied ${total} row references.`);
