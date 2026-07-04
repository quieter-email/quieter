import { z } from "zod";
import { listLinearIssueMetadata } from "../connectors/service";
import {
  createMailboxAction,
  getMailboxAction,
  listMailboxActions,
  publishMailboxAction,
  saveMailboxActionDraft,
  setMailboxActionEnabled,
} from "../mailbox-actions/service";
import { mailboxIdSchema, protectedProcedure } from "./base";

const actionIdSchema = z.string().trim().min(1);
const credentialIdSchema = z.string().trim().min(1);

export const mailboxActionsRouter = {
  create: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        name: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return await createMailboxAction({ ...input, userId: context.userId });
    }),

  get: protectedProcedure
    .input(z.object({ actionId: actionIdSchema }))
    .handler(async ({ context, input }) => {
      return await getMailboxAction({ ...input, userId: context.userId });
    }),

  linearMetadata: protectedProcedure
    .input(z.object({ credentialId: credentialIdSchema }))
    .handler(async ({ context, input }) => {
      return await listLinearIssueMetadata({
        ...input,
        signal: context.signal,
        userId: context.userId,
      });
    }),

  list: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      return await listMailboxActions({ ...input, userId: context.userId });
    }),

  publish: protectedProcedure
    .input(z.object({ actionId: actionIdSchema }))
    .handler(async ({ context, input }) => {
      return await publishMailboxAction({ ...input, userId: context.userId });
    }),

  saveDraft: protectedProcedure
    .input(
      z.object({
        actionId: actionIdSchema,
        graph: z.unknown(),
        name: z.string().trim().min(1).max(120).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return await saveMailboxActionDraft({ ...input, userId: context.userId });
    }),

  setEnabled: protectedProcedure
    .input(
      z.object({
        actionId: actionIdSchema,
        enabled: z.boolean(),
      }),
    )
    .handler(async ({ context, input }) => {
      return await setMailboxActionEnabled({ ...input, userId: context.userId });
    }),
};
