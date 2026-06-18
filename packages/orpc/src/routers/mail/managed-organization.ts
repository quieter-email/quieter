import {
  mailboxSavedViewDefinitionSchema,
  managedMailboxRuleDefinitionSchema,
} from "@quieter/mail/mailbox-organization";
import { z } from "zod";
import { listManagedLabelCounts, reorderManagedLabels } from "../../managed-mail/labels/service";
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
import {
  createManagedSavedView,
  deleteManagedSavedView,
  listManagedSavedViews,
  reorderManagedSavedViews,
  updateManagedSavedView,
} from "../../managed-mail/saved-views/service";
import { mailboxIdSchema, protectedProcedure } from "../base";

export const managedOrganizationMailRouter = {
  listManagedLabelCounts: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) =>
      listManagedLabelCounts({ ...input, userId: context.userId }),
    ),
  reorderManagedLabels: protectedProcedure
    .input(
      z.object({
        labelIds: z.array(z.string().trim().min(1)),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) =>
      reorderManagedLabels({ ...input, userId: context.userId }),
    ),
  listManagedSavedViews: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) =>
      listManagedSavedViews({ ...input, userId: context.userId }),
    ),
  createManagedSavedView: protectedProcedure
    .input(
      z.object({
        definition: mailboxSavedViewDefinitionSchema,
        mailboxId: mailboxIdSchema,
        shared: z.boolean(),
      }),
    )
    .handler(async ({ context, input }) =>
      createManagedSavedView({ ...input, userId: context.userId }),
    ),
  updateManagedSavedView: protectedProcedure
    .input(
      z.object({
        definition: mailboxSavedViewDefinitionSchema,
        mailboxId: mailboxIdSchema,
        viewId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) =>
      updateManagedSavedView({ ...input, userId: context.userId }),
    ),
  deleteManagedSavedView: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema, viewId: z.string().trim().min(1) }))
    .handler(async ({ context, input }) =>
      deleteManagedSavedView({ ...input, userId: context.userId }),
    ),
  reorderManagedSavedViews: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        viewIds: z.array(z.string().trim().min(1)),
      }),
    )
    .handler(async ({ context, input }) =>
      reorderManagedSavedViews({ ...input, userId: context.userId }),
    ),
  listManagedRules: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => listManagedRules({ ...input, userId: context.userId })),
  createManagedRule: protectedProcedure
    .input(
      z.object({
        definition: managedMailboxRuleDefinitionSchema,
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) => createManagedRule({ ...input, userId: context.userId })),
  updateManagedRule: protectedProcedure
    .input(
      z.object({
        definition: managedMailboxRuleDefinitionSchema,
        mailboxId: mailboxIdSchema,
        ruleId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => updateManagedRule({ ...input, userId: context.userId })),
  deleteManagedRule: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema, ruleId: z.string().trim().min(1) }))
    .handler(async ({ context, input }) => deleteManagedRule({ ...input, userId: context.userId })),
  reorderManagedRules: protectedProcedure
    .input(
      z.object({
        mailboxId: mailboxIdSchema,
        ruleIds: z.array(z.string().trim().min(1)),
      }),
    )
    .handler(async ({ context, input }) =>
      reorderManagedRules({ ...input, userId: context.userId }),
    ),
  previewManagedRule: protectedProcedure
    .input(
      z.object({
        definition: managedMailboxRuleDefinitionSchema,
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) =>
      previewManagedRule({ ...input, userId: context.userId }),
    ),
  startManagedRuleBackfill: protectedProcedure
    .input(z.object({ mailboxId: mailboxIdSchema, ruleId: z.string().trim().min(1) }))
    .handler(async ({ context, input }) =>
      startManagedRuleBackfill({ ...input, userId: context.userId }),
    ),
  getManagedRuleBackfill: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        backfillId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) =>
      getManagedRuleBackfill({ ...input, userId: context.userId }),
    ),
  cancelManagedRuleBackfill: protectedProcedure
    .input(
      z.object({
        backfillId: z.string().trim().min(1),
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) =>
      cancelManagedRuleBackfill({ ...input, userId: context.userId }),
    ),
};
