import { createHash } from "node:crypto";

import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { listGmailPubSubMaintenanceJobs } from "@quieter/orpc/gmail-pubsub";

import { withSentry } from "./sentry";

let sqsClient: SQSClient | null = null;

const getSqsClient = () => {
  sqsClient ??= new SQSClient({
    region: serverEnv.AWS_REGION ?? serverEnv.AWS_DEFAULT_REGION,
  });
  return sqsClient;
};

const enqueueMaintenanceBatch = async (
  batch: Awaited<ReturnType<typeof listGmailPubSubMaintenanceJobs>>,
  maintenanceWindow: number,
  queueUrl: string
) => {
  const response = await getSqsClient().send(
    new SendMessageBatchCommand({
      Entries: batch.map((job) => ({
        Id: job.mailboxId,
        MessageBody: JSON.stringify({
          mailboxId: job.mailboxId,
          type: "maintenance",
        }),
        MessageDeduplicationId: `maintenance:${maintenanceWindow}:${job.mailboxId}`,
        MessageGroupId: createHash("sha256")
          .update(job.emailAddress.trim().toLowerCase())
          .digest("hex"),
      })),
      QueueUrl: queueUrl,
    })
  );

  const failedCount = response.Failed?.length ?? 0;
  if (failedCount > 0) {
    throw new Error(
      `Could not enqueue ${failedCount} Gmail Pub/Sub maintenance jobs.`
    );
  }
};

export const handler = withSentry("GmailPubSubMaintenance", async () => {
  const queueUrl = requireServerEnv("GMAIL_PUBSUB_QUEUE_URL");
  const jobs = await listGmailPubSubMaintenanceJobs();
  const maintenanceWindow = Math.floor(Date.now() / (1000 * 60 * 15));
  const batches = Array.from(
    { length: Math.ceil(jobs.length / 10) },
    (_, index) => jobs.slice(index * 10, index * 10 + 10)
  );

  await Promise.all(
    batches.map(async (batch) => {
      await enqueueMaintenanceBatch(batch, maintenanceWindow, queueUrl);
    })
  );

  return { enqueued: jobs.length };
});
