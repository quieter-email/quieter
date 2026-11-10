import {
  createScheduledSendSchema,
  rescheduleSendSchema,
  scheduledSendActionSchema,
  scheduledSendMailboxSchema,
  scheduledSendOperationSchema,
} from "@quieter/mail/scheduled-send";

import {
  cancelScheduledSend,
  createScheduledSend,
  getScheduledSendByOperation,
  listScheduledSends,
  rescheduleSend,
} from "../scheduled-send/service";
import { protectedProcedure } from "./base";

export const scheduledSendsRouter = {
  cancel: protectedProcedure
    .input(scheduledSendActionSchema)
    .handler(
      async ({ context, input }) =>
        await cancelScheduledSend({ ...input, userId: context.userId })
    ),
  create: protectedProcedure
    .input(createScheduledSendSchema)
    .handler(
      async ({ context, input }) =>
        await createScheduledSend({ ...input, userId: context.userId })
    ),
  getByOperation: protectedProcedure
    .input(scheduledSendOperationSchema)
    .handler(
      async ({ context, input }) =>
        await getScheduledSendByOperation({ ...input, userId: context.userId })
    ),
  list: protectedProcedure
    .input(scheduledSendMailboxSchema)
    .handler(
      async ({ context, input }) =>
        await listScheduledSends({ ...input, userId: context.userId })
    ),
  reschedule: protectedProcedure
    .input(rescheduleSendSchema)
    .handler(
      async ({ context, input }) =>
        await rescheduleSend({ ...input, userId: context.userId })
    ),
};
