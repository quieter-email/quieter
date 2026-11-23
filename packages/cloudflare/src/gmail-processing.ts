import { serverEnv } from "@quieter/env/server";
import type { GmailPubSubNotificationMessage } from "@quieter/orpc/gmail-pubsub";

import { readBoundedJson } from "./bounded-json";
import {
  GMAIL_JOB_BODY_LIMIT,
  GMAIL_PROCESSING_URL,
  gmailJobDecisionSchema,
  gmailJobSchema,
} from "./gmail-processing-job";
import type { GmailJob } from "./gmail-processing-job";
import { broadcastGmailUpdate } from "./mail-updates";
import { reportWorkerError } from "./worker-runtime";

export const sendGmailProcessingJob = async (
  env: Pick<Env, "GmailProcessingWorker">,
  job: GmailJob
) => {
  const body = JSON.stringify(job);
  if (new TextEncoder().encode(body).byteLength > GMAIL_JOB_BODY_LIMIT) {
    throw new Error("Gmail processing job exceeds the transport limit.");
  }
  const response = await env.GmailProcessingWorker.fetch(GMAIL_PROCESSING_URL, {
    body,
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.status !== 200) {
    throw new Error("Gmail processing service failed.");
  }
  const decision = gmailJobDecisionSchema.parse(
    await readBoundedJson(response, 1024)
  );
  const placement = response.headers.get("cf-placement");
  if (placement !== null && /^(?:local|remote)-[A-Z]{3}$/u.test(placement)) {
    // oxlint-disable-next-line no-console -- Private infrastructure placement contains no job or account data.
    console.info({ event: "gmail_processing_placement", placement });
  }
  return decision;
};

export const acceptGmailNotification = async (
  notification: GmailPubSubNotificationMessage,
  env: Pick<Env, "GmailProcessingWorker" | "MailLiveUser">,
  ctx?: Pick<ExecutionContext, "waitUntil">
) => {
  const decision = await sendGmailProcessingJob(env, {
    ...notification,
    notificationReceivedAt: Date.now(),
  });
  if (decision.action !== "ack") {
    throw new Error("Gmail notification was not accepted.");
  }
  if (serverEnv.QUIETER_GMAIL_EVENTS_ENABLED === true) {
    return;
  }
  const broadcast = (async () => {
    try {
      await broadcastGmailUpdate(
        env,
        notification.emailAddress,
        "mailbox.changed",
        notification.historyId
      );
    } catch (error) {
      reportWorkerError(error, {
        category: "gmail_processing_intake_broadcast_error",
        route: "gmail/pubsub",
      });
    }
  })();
  if (ctx === undefined) {
    await broadcast;
  } else {
    ctx.waitUntil(broadcast);
  }
};

export const processGmailQueue = async (
  batch: MessageBatch,
  env: Pick<Env, "GmailProcessingWorker">
) => {
  for (const message of batch.messages) {
    try {
      const decision = await sendGmailProcessingJob(
        env,
        gmailJobSchema.parse(message.body)
      );
      if (decision.action === "ack") {
        message.ack();
      } else {
        message.retry({ delaySeconds: decision.delaySeconds });
      }
    } catch (error) {
      reportWorkerError(error, {
        category: "gmail_processing_transport_error",
        route: "queue",
      });
      message.retry({ delaySeconds: 60 });
    }
  }
};
