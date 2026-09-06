import { withRequestDatabaseClient } from "@quieter/database/client";
import type { DatabaseClient } from "@quieter/database/client";
import { recoverUnknownMailAttempts } from "@quieter/database/mail-attempts";
import {
  dispatchMailOutbox,
  recoverQueuedMailOutbox,
} from "@quieter/database/mail-outbox";
import { mailSubmissionWakeSchema } from "@quieter/mail/submission-events";
import type { MailSubmissionWake } from "@quieter/mail/submission-events";

import { withMailOperationDeadline } from "./mail-operation-deadline.ts";
import { publishMailSubmissionEvent } from "./mail-submission-queue.ts";
import type { MailSubmissionQueueBindings } from "./mail-submission-queue.ts";
import { reportWorkerError, withSentryReporting } from "./worker-runtime";

type MailPublisherBindings = MailSubmissionQueueBindings & {
  MailSubmissionWakeQueue: Pick<Queue<MailSubmissionWake>, "send">;
};

export const publishPendingMailSubmissions = async (
  database: DatabaseClient,
  bindings: MailSubmissionQueueBindings,
  recover: boolean
) => {
  const owner = crypto.randomUUID();
  if (recover) {
    await recoverUnknownMailAttempts(database, 100);
    await recoverQueuedMailOutbox(database, 100);
  }
  let published = 0;
  for (let batch = 0; batch < 12; batch += 1) {
    // oxlint-disable-next-line no-await-in-loop -- Drain at most sixty events per invocation with five concurrent publications.
    const result = await dispatchMailOutbox(database, {
      limit: 5,
      owner,
      publish: async (event) =>
        await publishMailSubmissionEvent(bindings, event),
    });
    published += result.published;
    if (result.deferred > 0 || result.claimed < 5) {
      return { deferred: result.deferred, more: false, published };
    }
  }
  return { deferred: 0, more: true, published };
};

const handler = {
  async queue(batch, env) {
    const [message, ...remaining] = batch.messages;
    for (const deferred of remaining) {
      deferred.retry({ delaySeconds: 1 });
    }
    if (message === undefined) {
      return;
    }
    try {
      if (!mailSubmissionWakeSchema.safeParse(message.body).success) {
        throw new Error("Unsupported mail outbox wakeup contract.");
      }
      const result = await withRequestDatabaseClient(
        async (database) =>
          await publishPendingMailSubmissions(database, env, false)
      );
      if (result.deferred > 0 || result.more) {
        if (result.deferred > 0) {
          reportWorkerError(
            new Error("Mail outbox publications were deferred."),
            { category: "mail_outbox_publication_deferred", route: "queue" }
          );
        }
        message.retry({ delaySeconds: result.deferred > 0 ? 30 : 1 });
      } else {
        message.ack();
      }
    } catch (error) {
      reportWorkerError(error, {
        category: "mail_outbox_wakeup_failed",
        route: "queue",
      });
      message.retry({ delaySeconds: 30 });
    }
  },
  async scheduled(_event, env) {
    try {
      const result = await withRequestDatabaseClient(
        async (database) =>
          await publishPendingMailSubmissions(database, env, true)
      );
      if (result.deferred > 0) {
        throw new Error("Mail outbox publications were deferred for recovery.");
      }
      if (result.more) {
        await withMailOperationDeadline(
          env.MailSubmissionWakeQueue.send(
            { schemaVersion: 1, type: "submission.outbox-ready" },
            { contentType: "json" }
          )
        );
      }
    } catch (error) {
      reportWorkerError(error, {
        category: "mail_outbox_recovery_failed",
        route: "scheduled",
      });
      throw error;
    }
  },
} satisfies ExportedHandler<MailPublisherBindings>;

export default withSentryReporting(handler);
