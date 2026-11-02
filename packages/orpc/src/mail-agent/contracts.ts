import { z } from "zod";

const mailboxInput = z.strictObject({ mailboxId: z.string().trim().min(1) });
export const mailAgentInputs = {
  activate: mailboxInput.extend({
    acknowledgeAssumptions: z.boolean(),
    revisionId: z.string().min(1),
    version: z.number().int().nonnegative(),
  }),
  get: mailboxInput,
  pause: mailboxInput.extend({ version: z.number().int().nonnegative() }),
  review: mailboxInput.extend({
    sourceText: z.string().trim().min(1).max(16_384),
    version: z.number().int().nonnegative(),
  }),
  run: mailboxInput.extend({
    invocationId: z.uuid(),
    threadId: z.string().min(1),
  }),
  threadResults: mailboxInput.extend({ threadId: z.string().min(1) }),
};

export const connectorMentionPattern =
  /@\[connection:(?<connectionId>[^\]\s]+)\]/gu;

export type MailAgentIncomingMessage = {
  mailboxId: string;
  messageId: string;
  receivedAt: Date;
  threadId: string;
};
