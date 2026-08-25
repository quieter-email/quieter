import { withRequestDatabaseClient } from "@quieter/database/client";
import { executeMailboxActionRun } from "@quieter/orpc/mailbox-actions";
import { z } from "zod";

import { reportWorkerError, withSentryReporting } from "./worker-runtime";

const mailboxActionMessageSchema = z.object({
  runId: z.string().trim().min(1),
});

// infra/actions.ts configures a retry limit of 5 on MailboxActionQueue, so the
// sixth failed delivery is the last one before the message reaches the DLQ.
const FINAL_QUEUE_ATTEMPT = 6;

export const processMailboxActionMessage = async (
  body: unknown,
  options: {
    attempt?: number;
    executeRun?: typeof executeMailboxActionRun;
  } = {}
) => {
  const { runId } = mailboxActionMessageSchema.parse(body);
  return await (options.executeRun ?? executeMailboxActionRun)(runId, {
    finalAttempt: (options.attempt ?? 1) >= FINAL_QUEUE_ATTEMPT,
  });
};

export default withSentryReporting({
  async queue(batch, _env, _ctx) {
    await withRequestDatabaseClient(async () => {
      await Promise.all(
        batch.messages.map(async (message) => {
          try {
            await processMailboxActionMessage(message.body, {
              attempt: message.attempts,
            });
            message.ack();
          } catch (error) {
            reportWorkerError(error, {
              category: "mailbox_action_processing_error",
              messageId: message.id,
              route: "queue",
            });
            message.retry({
              delaySeconds: Math.min(15 * 60, 5 * 2 ** message.attempts),
            });
          }
        })
      );
    });
  },
} satisfies ExportedHandler<Env>);
