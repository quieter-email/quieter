import {
  syncCheckpointSchema,
  syncCommandSchema,
  syncIdSchema,
} from "@quieter/sync";
import { z } from "zod";

import { mailSyncOperations } from "../../mail-sync";
import {
  getMailSyncCommand,
  submitMailSyncCommand,
} from "../../mail-sync-commands";
import { protectedProcedure } from "../base";

const mailboxInput = z.object({ mailboxId: syncIdSchema });

export const mailSyncRouter = {
  createSyncConnection: protectedProcedure.handler(
    ({ context }): ReturnType<typeof mailSyncOperations.connection> =>
      mailSyncOperations.connection(context.userId, context.sessionId)
  ),
  getSyncBody: protectedProcedure
    .input(
      mailboxInput.extend({
        hash: z.string().regex(/^[a-f0-9]{64}$/u),
        messageId: syncIdSchema,
      })
    )
    .handler(
      async ({
        input,
        context,
      }): Promise<Awaited<ReturnType<typeof mailSyncOperations.body>>> =>
        await mailSyncOperations.body({ ...input, userId: context.userId })
    ),
  getSyncCommand: protectedProcedure
    .input(mailboxInput.extend({ commandId: z.uuid() }))
    .handler(
      async ({
        input,
        context,
      }): Promise<Awaited<ReturnType<typeof getMailSyncCommand>>> =>
        await getMailSyncCommand(
          input.mailboxId,
          input.commandId,
          context.userId
        )
    ),
  getSyncReplay: protectedProcedure
    .input(mailboxInput.extend({ checkpoint: syncCheckpointSchema }))
    .handler(
      async ({
        input,
        context,
      }): Promise<Awaited<ReturnType<typeof mailSyncOperations.replay>>> =>
        await mailSyncOperations.replay({ ...input, userId: context.userId })
    ),
  getSyncSnapshot: protectedProcedure
    .input(mailboxInput)
    .handler(
      async ({
        input,
        context,
      }): Promise<Awaited<ReturnType<typeof mailSyncOperations.snapshot>>> =>
        await mailSyncOperations.snapshot({ ...input, userId: context.userId })
    ),
  hydrateSyncThreads: protectedProcedure
    .input(
      mailboxInput.extend({ threadIds: z.array(syncIdSchema).min(1).max(25) })
    )
    .handler(
      async ({
        input,
        context,
      }): Promise<Awaited<ReturnType<typeof mailSyncOperations.hydrate>>> =>
        await mailSyncOperations.hydrate({ ...input, userId: context.userId })
    ),
  refreshSyncMailbox: protectedProcedure
    .input(mailboxInput)
    .handler(async ({ input, context }): Promise<void> => {
      await mailSyncOperations.refresh({ ...input, userId: context.userId });
    }),
  submitSyncCommand: protectedProcedure
    .input(syncCommandSchema)
    .handler(
      async ({
        input,
        context,
      }): Promise<Awaited<ReturnType<typeof submitMailSyncCommand>>> =>
        await submitMailSyncCommand(input, context.userId)
    ),
};
