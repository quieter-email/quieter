import { withRequestDatabaseClient } from "@quieter/database/client";
import { mailSubmissionEventSchema } from "@quieter/mail/submission-events";
import {
  projectMailSubmission,
  recoverMailSubmissionProjections,
} from "@quieter/orpc/mail-submission-projection";

import { R2SubmissionPayloadStorage } from "./submission-payload-storage.ts";
import { reportWorkerError, withSentryReporting } from "./worker-runtime.ts";

type ProjectionBindings = { MailSubmissionPayloads: R2Bucket };

export const mailSubmissionProjectionHandler = {
  async queue(batch, env) {
    const [message, ...remaining] = batch.messages;
    for (const deferred of remaining) {
      deferred.retry({ delaySeconds: 1 });
    }
    if (message === undefined) {
      return;
    }
    try {
      const event = mailSubmissionEventSchema.parse(message.body);
      await withRequestDatabaseClient(
        async (database) =>
          await projectMailSubmission(
            database,
            event,
            new R2SubmissionPayloadStorage(env.MailSubmissionPayloads)
          )
      );
      message.ack();
    } catch {
      reportWorkerError(new Error("Mail history projection failed."), {
        category: "mail_projection_failed",
        route: "queue",
      });
      message.retry({ delaySeconds: 30 });
    }
  },
  async scheduled(_event, env) {
    try {
      const result = await withRequestDatabaseClient(
        async (database) =>
          await recoverMailSubmissionProjections(
            database,
            new R2SubmissionPayloadStorage(env.MailSubmissionPayloads)
          )
      );
      if (result.deferred > 0) {
        throw new Error("Mail history projection recovery was deferred.");
      }
    } catch {
      const error = new Error("Mail history projection recovery failed.");
      reportWorkerError(error, {
        category: "mail_projection_recovery_failed",
        route: "scheduled",
      });
      throw error;
    }
  },
} satisfies ExportedHandler<ProjectionBindings>;

export default withSentryReporting({ ...mailSubmissionProjectionHandler });
