import { z } from "zod";

import { listLinearIssueMetadata } from "../connectors/service";
import {
  createMailboxAction,
  deleteMailboxAction,
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
      })
    )
    .handler(
      async ({ context, input }) =>
        await createMailboxAction({ ...input, userId: context.userId })
    ),

  delete: protectedProcedure
    .input(z.object({ actionId: actionIdSchema }))
    .handler(
      async ({ context, input }) =>
        await deleteMailboxAction({ ...input, userId: context.userId })
    ),

  get: protectedProcedure
    .input(z.object({ actionId: actionIdSchema }))
    .handler(
      async ({ context, input }) =>
        await getMailboxAction({ ...input, userId: context.userId })
    ),

  linearMetadata: protectedProcedure
    .input(z.object({ credentialId: credentialIdSchema }))
    .handler(
      async ({ context, input }) =>
        await listLinearIssueMetadata({
          ...input,
          signal: context.signal,
          userId: context.userId,
        })
    ),

  list: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(
      async ({ context, input }) =>
        await listMailboxActions({ ...input, userId: context.userId })
    ),

  publish: protectedProcedure
    .input(z.object({ actionId: actionIdSchema }))
    .handler(
      async ({ context, input }) =>
        await publishMailboxAction({ ...input, userId: context.userId })
    ),

  saveDraft: protectedProcedure
    .input(
      z.object({
        actionId: actionIdSchema,
        graph: z.unknown(),
        name: z.string().trim().min(1).max(120).optional(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await saveMailboxActionDraft({ ...input, userId: context.userId })
    ),

  setEnabled: protectedProcedure
    .input(
      z.object({
        actionId: actionIdSchema,
        enabled: z.boolean(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await setMailboxActionEnabled({ ...input, userId: context.userId })
    ),
};
