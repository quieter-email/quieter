import { withRequestDatabaseClient } from "@quieter/database/client";
import { storeMailSendCapacity } from "@quieter/database/mail-send-capacity";
import { createMailSenderEnv } from "@quieter/env/mail-sender";
import { SesSubmissionTransport } from "@quieter/mail/ses-submission-transport";
import { mailSubmissionEventSchema } from "@quieter/mail/submission-events";
import type { MailSubmissionWake } from "@quieter/mail/submission-events";
import { dispatchMailSubmission } from "@quieter/orpc/mail-submission-sender";

import { withMailOperationDeadline } from "./mail-operation-deadline.ts";
import { R2SubmissionPayloadStorage } from "./submission-payload-storage.ts";
import { reportWorkerError, withSentryReporting } from "./worker-runtime.ts";

export type MailSenderBindings = Parameters<typeof createMailSenderEnv>[0] & {
  MailSubmissionPayloads: R2Bucket;
  MailSubmissionWakeQueue: Pick<Queue<MailSubmissionWake>, "send">;
};

export const mailSubmissionSenderHandler = {
  async queue(batch, env) {
    const [message, ...remaining] = batch.messages;
    for (const deferred of remaining) {
      deferred.retry({ delaySeconds: 1 });
    }
    if (message === undefined) {
      return;
    }
    let transport: SesSubmissionTransport | undefined;
    try {
      const config = createMailSenderEnv(env);
      if (config === null) {
        message.retry({ delaySeconds: 30 });
        return;
      }
      const event = mailSubmissionEventSchema.parse(message.body);
      if (
        event.eventType !== "submission.dispatch" ||
        !config.organizationIds.includes(event.organizationId)
      ) {
        throw new Error("Unsupported mail dispatch or organization.");
      }
      const sender = new SesSubmissionTransport(config);
      transport = sender;
      await withRequestDatabaseClient(
        async (database) =>
          await dispatchMailSubmission(database, {
            capacityKey: `${config.accountId}:${config.region}`,
            organizationId: event.organizationId,
            owner: crypto.randomUUID(),
            region: config.region,
            send: async (submission) => await sender.send(submission),
            storage: new R2SubmissionPayloadStorage(env.MailSubmissionPayloads),
            submissionId: event.submissionId,
          })
      );
      message.ack();
      try {
        await withMailOperationDeadline(
          env.MailSubmissionWakeQueue.send(
            { schemaVersion: 1, type: "submission.outbox-ready" },
            { contentType: "json" }
          )
        );
      } catch {
        reportWorkerError(
          new Error("Mail dispatch requires scheduled outbox recovery."),
          { category: "mail_sender_wakeup_failed", route: "queue" }
        );
      }
    } catch {
      reportWorkerError(new Error("Mail dispatch could not complete."), {
        category: "mail_sender_failed",
        route: "queue",
      });
      message.retry({ delaySeconds: 30 });
    } finally {
      transport?.close();
    }
  },
  async scheduled(_event, env) {
    let transport: SesSubmissionTransport | undefined;
    try {
      const config = createMailSenderEnv(env);
      if (config === null) {
        return;
      }
      transport = new SesSubmissionTransport(config);
      const capacity = await transport.inspectCapacity();
      await withRequestDatabaseClient(async (database) => {
        await storeMailSendCapacity(database, {
          ...capacity,
          accountId: config.accountId,
          region: config.region,
        });
      });
    } catch {
      const error = new Error("Mail sending capacity refresh failed.");
      reportWorkerError(error, {
        category: "mail_sender_capacity_failed",
        route: "scheduled",
      });
      throw error;
    } finally {
      transport?.close();
    }
  },
} satisfies ExportedHandler<MailSenderBindings>;

export default withSentryReporting({ ...mailSubmissionSenderHandler });
