import type { ChatMiddleware } from "@tanstack/ai";
import { ORPCError } from "@orpc/server";
import { reportAiUsage } from "@quieter/billing";
import { getBillingCreditUsage } from "@quieter/billing/credits";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { db } from "@quieter/database/client";
import { mailTemplate, member, type MailTemplateScope } from "@quieter/database/schema";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import { assertAccessibleMailbox } from "../mailbox/service";
import { mailboxIdSchema, protectedProcedure } from "./base";

const mailTemplateIdSchema = z.string().trim().min(1);
const mailTemplateScopeSchema = z.enum(["personal", "team"]);
const mailTemplateFieldsSchema = z.object({
  bodyHtml: z.string().trim().min(1).max(100_000),
  name: z.string().trim().min(1).max(120),
  scope: mailTemplateScopeSchema,
  subject: z.string().trim().max(998),
});
const mailTemplateMutationSchema = mailTemplateFieldsSchema.extend({
  mailboxId: mailboxIdSchema,
});
const hasOrganizationManagerRole = (role: string | null | undefined) =>
  !!role
    ?.split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === "admin" || part === "owner");

const getTemplateMailboxContext = async (mailboxId: string, userId: string) => {
  const accessibleMailbox = await assertAccessibleMailbox({ mailboxId, userId });
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.organizationId, accessibleMailbox.organizationId), eq(member.userId, userId)),
    )
    .limit(1);

  return {
    canManageTeamTemplates: hasOrganizationManagerRole(membership?.role),
    mailbox: accessibleMailbox,
    membership: membership ?? null,
  };
};

const serializeTemplate = (
  template: typeof mailTemplate.$inferSelect,
  canManageTeamTemplates: boolean,
) => ({
  bodyHtml: template.bodyHtml,
  canEdit: template.scope === "personal" || canManageTeamTemplates,
  createdAt: template.createdAt,
  id: template.id,
  name: template.name,
  scope: template.scope,
  subject: template.subject,
  updatedAt: template.updatedAt,
});

const getAuthorizedTemplate = async ({
  canManageTeamTemplates,
  id,
  organizationId,
  userId,
}: {
  canManageTeamTemplates: boolean;
  id: string;
  organizationId: string;
  userId: string;
}) => {
  const [template] = await db.select().from(mailTemplate).where(eq(mailTemplate.id, id)).limit(1);
  const canModify =
    template?.scope === "personal"
      ? template.userId === userId
      : template?.organizationId === organizationId && canManageTeamTemplates;

  if (!template || !canModify) {
    throw new ORPCError("NOT_FOUND", {
      message: "Template not found.",
    });
  }

  return template;
};

const assertCanWriteScope = ({
  canManageTeamTemplates,
  scope,
}: {
  canManageTeamTemplates: boolean;
  scope: MailTemplateScope;
}) => {
  if (scope === "team" && !canManageTeamTemplates) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only team owners and admins can manage shared templates.",
    });
  }
};

const assertCanUseAi = async ({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) => {
  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId,
    userId,
  });

  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: `AI suggestions require ${BILLING_FEATURES.aiChat.requirementLabel}.`,
    });
  }

  if (entitlement.hasUnlimitedAccess || !entitlement.account) return;

  const usage = await getBillingCreditUsage(entitlement.account);
  if (usage.costMicroCents >= usage.creditAmountMicroCents) {
    throw new ORPCError("FORBIDDEN", {
      message: "AI suggestions require available usage balance.",
    });
  }
};

export const mailTemplatesRouter = {
  list: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ mailboxId: mailboxIdSchema }))
    .handler(async ({ context, input }) => {
      const { canManageTeamTemplates, mailbox, membership } = await getTemplateMailboxContext(
        input.mailboxId,
        context.userId,
      );
      const templates = await db
        .select()
        .from(mailTemplate)
        .where(
          membership
            ? or(
                eq(mailTemplate.userId, context.userId),
                eq(mailTemplate.organizationId, mailbox.organizationId),
              )
            : eq(mailTemplate.userId, context.userId),
        )
        .orderBy(desc(mailTemplate.updatedAt));

      return {
        canManageTeamTemplates,
        organizationId: mailbox.organizationId,
        templates: templates.map((template) => serializeTemplate(template, canManageTeamTemplates)),
      };
    }),

  create: protectedProcedure
    .input(mailTemplateMutationSchema)
    .handler(async ({ context, input }) => {
      const { canManageTeamTemplates, mailbox } = await getTemplateMailboxContext(
        input.mailboxId,
        context.userId,
      );
      assertCanWriteScope({ canManageTeamTemplates, scope: input.scope });
      const now = new Date();
      const [created] = await db
        .insert(mailTemplate)
        .values({
          bodyHtml: input.bodyHtml,
          createdAt: now,
          id: crypto.randomUUID(),
          name: input.name,
          organizationId: input.scope === "team" ? mailbox.organizationId : null,
          scope: input.scope,
          subject: input.subject,
          updatedAt: now,
          userId: input.scope === "personal" ? context.userId : null,
        })
        .returning();

      return serializeTemplate(created!, canManageTeamTemplates);
    }),

  update: protectedProcedure
    .input(
      mailTemplateMutationSchema.extend({
        id: mailTemplateIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const { canManageTeamTemplates, mailbox } = await getTemplateMailboxContext(
        input.mailboxId,
        context.userId,
      );
      await getAuthorizedTemplate({
        canManageTeamTemplates,
        id: input.id,
        organizationId: mailbox.organizationId,
        userId: context.userId,
      });
      assertCanWriteScope({ canManageTeamTemplates, scope: input.scope });
      const [updated] = await db
        .update(mailTemplate)
        .set({
          bodyHtml: input.bodyHtml,
          name: input.name,
          organizationId: input.scope === "team" ? mailbox.organizationId : null,
          scope: input.scope,
          subject: input.subject,
          updatedAt: new Date(),
          userId: input.scope === "personal" ? context.userId : null,
        })
        .where(eq(mailTemplate.id, input.id))
        .returning();

      return serializeTemplate(updated!, canManageTeamTemplates);
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: mailTemplateIdSchema,
        mailboxId: mailboxIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      const { canManageTeamTemplates, mailbox } = await getTemplateMailboxContext(
        input.mailboxId,
        context.userId,
      );
      const template = await getAuthorizedTemplate({
        canManageTeamTemplates,
        id: input.id,
        organizationId: mailbox.organizationId,
        userId: context.userId,
      });
      await db.delete(mailTemplate).where(eq(mailTemplate.id, template.id));
      return { id: template.id };
    }),

  suggestPlaceholder: protectedProcedure
    .input(
      z.object({
        bodyText: z.string().max(20_000),
        mailboxId: mailboxIdSchema,
        placeholder: z.string().trim().min(1).max(80),
        recipients: z.string().max(5_000),
        subject: z.string().max(998),
        templateName: z.string().trim().min(1).max(120),
      }),
    )
    .handler(async ({ context, input }) => {
      const { mailbox } = await getTemplateMailboxContext(input.mailboxId, context.userId);
      await assertCanUseAi({
        organizationId: mailbox.organizationId,
        userId: context.userId,
      });
      const { suggestTemplatePlaceholder, TEMPLATE_PLACEHOLDER_SUGGESTION_MODEL } =
        await import("@quieter/ai/suggest-template-placeholder");
      const requestId = crypto.randomUUID();
      const usageMiddleware: ChatMiddleware = {
        name: "polar-ai-template-placeholder-usage",
        onUsage: (usageContext, usage) => {
          usageContext.defer(
            reportAiUsage({
              chatId: null,
              completionTokens: usage.completionTokens,
              costUsd: usage.cost,
              externalId: `template-placeholder:${requestId}`,
              mailboxId: input.mailboxId,
              model: TEMPLATE_PLACEHOLDER_SUGGESTION_MODEL,
              promptTokens: usage.promptTokens,
              promptTokensDetails: usage.promptTokensDetails,
              usageKind: "aiChat",
              userId: context.userId,
            }).catch((error) => {
              console.error(
                "Could not report template placeholder AI usage.",
                error instanceof Error ? error.message : "Unknown error.",
              );
            }),
          );
        },
      };
      const value = await suggestTemplatePlaceholder({
        bodyText: input.bodyText,
        middleware: [usageMiddleware],
        placeholder: input.placeholder,
        recipients: input.recipients,
        subject: input.subject,
        templateName: input.templateName,
      }).catch((error) => {
        console.error(
          "Could not suggest a template placeholder value.",
          error instanceof Error ? error.message : "Unknown error.",
        );
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Could not suggest a value right now.",
        });
      });

      return { value };
    }),
};
