import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import { requireServerEnv, serverEnv } from "@quieter/env/server";
import { listGmailPubSubMaintenanceJobs } from "@quieter/orpc/gmail-pubsub";
import { createHash } from "node:crypto";

let sqsClient: SQSClient | null = null;

const getSqsClient = () => {
  sqsClient ??= new SQSClient({
    region: serverEnv.AWS_REGION || serverEnv.AWS_DEFAULT_REGION,
  });
  return sqsClient;
};

export const handler = async () => {
  const queueUrl = requireServerEnv("GMAIL_PUBSUB_QUEUE_URL");
  const jobs = await listGmailPubSubMaintenanceJobs();
  const maintenanceWindow = Math.floor(Date.now() / (1000 * 60 * 15));

  for (let index = 0; index < jobs.length; index += 10) {
    const batch = jobs.slice(index, index + 10);
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
      }),
    );

    if (response.Failed?.length) {
      throw new Error(
        `Could not enqueue ${response.Failed.length} Gmail Pub/Sub maintenance jobs.`,
      );
    }
  }

  return { enqueued: jobs.length };
};
