import { withRequestDatabaseClient } from "@quieter/database/client";
import { executeMailboxActionRun } from "@quieter/orpc/mailbox-actions";
import { z } from "zod";

import { reportWorkerError } from "./worker-runtime";

const mailboxActionMessageSchema = z.object({
  runId: z.string().trim().min(1),
});

export const processMailboxActionMessage = async (
  body: unknown,
  executeRun: typeof executeMailboxActionRun = executeMailboxActionRun
) => {
  const { runId } = mailboxActionMessageSchema.parse(body);
  return await executeRun(runId);
};

export default {
  async queue(batch, _env, _ctx) {
    await withRequestDatabaseClient(async () => {
      await Promise.all(
        batch.messages.map(async (message) => {
          try {
            await processMailboxActionMessage(message.body);
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
} satisfies ExportedHandler<Env>;
