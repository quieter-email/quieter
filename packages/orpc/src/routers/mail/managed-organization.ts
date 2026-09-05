import { managedMailboxRuleDefinitionSchema } from "@quieter/mail/mailbox-organization";
import { z } from "zod";

import {
  listManagedLabelCounts,
  reorderManagedLabels,
} from "../../managed-mail/labels/service";
import {
  cancelManagedRuleBackfill,
  createManagedRule,
  deleteManagedRule,
  getManagedRuleBackfill,
  listManagedRules,
  previewManagedRule,
  reorderManagedRules,
  startManagedRuleBackfill,
  updateManagedRule,
} from "../../managed-mail/rules/service";
import { mailboxIdSchema, protectedProcedure } from "../base";

export const managedOrganizationMailRouter = {
  cancelManagedRuleBackfill: protectedProcedure
    .input(
      z.object({
        backfillId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await cancelManagedRuleBackfill({ ...input, userId: context.userId })
    ),
  createManagedRule: protectedProcedure
    .input(
      z.object({
        definition: managedMailboxRuleDefinitionSchema,
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await createManagedRule({ ...input, userId: context.userId })
    ),
  deleteManagedRule: protectedProcedure
    .input(
      z.object({ mailboxId: mailboxIdSchema, ruleId: z.string().trim().min(1) })
    )
    .handler(
      async ({ context, input }) =>
        await deleteManagedRule({ ...input, userId: context.userId })
    ),
  getManagedRuleBackfill: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        backfillId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await getManagedRuleBackfill({ ...input, userId: context.userId })
    ),
  listManagedLabelCounts: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(
      async ({ context, input }) =>
        await listManagedLabelCounts({ ...input, userId: context.userId })
    ),
  listManagedRules: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(
      async ({ context, input }) =>
        await listManagedRules({ ...input, userId: context.userId })
    ),
  previewManagedRule: protectedProcedure
    .input(
      z.object({
        definition: managedMailboxRuleDefinitionSchema,
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await previewManagedRule({ ...input, userId: context.userId })
    ),
  reorderManagedLabels: protectedProcedure
    .input(
      z.object({
        labelIds: z.array(z.string().trim().min(1)),
        mailboxId: mailboxIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await reorderManagedLabels({ ...input, userId: context.userId })
    ),
  reorderManagedRules: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        ruleIds: z.array(z.string().trim().min(1)),
      })
    )
    .handler(
      async ({ context, input }) =>
        await reorderManagedRules({ ...input, userId: context.userId })
    ),
  startManagedRuleBackfill: protectedProcedure
    .input(
      z.object({ mailboxId: mailboxIdSchema, ruleId: z.string().trim().min(1) })
    )
    .handler(
      async ({ context, input }) =>
        await startManagedRuleBackfill({ ...input, userId: context.userId })
    ),
  updateManagedRule: protectedProcedure
    .input(
      z.object({
        definition: managedMailboxRuleDefinitionSchema,
        mailboxId: mailboxIdSchema,
        ruleId: z.string().trim().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await updateManagedRule({ ...input, userId: context.userId })
    ),
};
