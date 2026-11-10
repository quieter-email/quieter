import { readBoundedJson } from "./bounded-json";
import {
  GMAIL_JOB_BODY_LIMIT,
  GMAIL_PROCESSING_URL,
  gmailJobDecisionSchema,
  gmailJobSchema,
} from "./gmail-processing-job";
import { reportWorkerError } from "./worker-runtime";

export {
  enqueueGmailMessageWork,
  enqueueGmailNotification,
} from "./gmail-processing-job";

export const processGmailQueue = async (
  batch: MessageBatch,
  env: Pick<Env, "GmailProcessingWorker">
) => {
  for (const message of batch.messages) {
    try {
      const parsed = gmailJobSchema.safeParse(message.body);
      if (!parsed.success) {
        throw new Error("Invalid Gmail processing job.");
      }
      const body = JSON.stringify(parsed.data);
      if (new TextEncoder().encode(body).byteLength > GMAIL_JOB_BODY_LIMIT) {
        throw new Error("Gmail processing job exceeds the transport limit.");
      }
      const response = await env.GmailProcessingWorker.fetch(
        GMAIL_PROCESSING_URL,
        {
          body,
          headers: { "content-type": "application/json" },
          method: "POST",
        }
      );
      if (response.status !== 200) {
        throw new Error("Gmail processing service failed.");
      }
      const decision = gmailJobDecisionSchema.safeParse(
        await readBoundedJson(response, 1024)
      );
      if (!decision.success) {
        throw new Error("Invalid Gmail processing decision.");
      }
      const placement = response.headers.get("cf-placement");
      if (
        placement !== null &&
        /^(?:local|remote)-[A-Z]{3}$/u.test(placement)
      ) {
        // oxlint-disable-next-line no-console -- Private infrastructure placement contains no job or account data.
        console.info({ event: "gmail_processing_placement", placement });
      }
      if (decision.data.action === "ack") {
        message.ack();
      } else {
        message.retry({ delaySeconds: decision.data.delaySeconds });
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
