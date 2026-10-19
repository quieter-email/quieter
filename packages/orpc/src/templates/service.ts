import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import type {
  DatabaseExecutor,
  DatabaseTransaction,
} from "@quieter/database/client";
import {
  organizationEmailTemplate,
  organizationTemplateOperation,
} from "@quieter/database/schema";
import {
  exportEmailDesign,
  renderEmailContent,
} from "@quieter/mail/email-design";
import { emailTemplateSchema } from "@quieter/mail/templates";
import type {
  EmailTemplate,
  templateArchiveInputSchema,
  templateCreateInputSchema,
  templateDuplicateInputSchema,
  templateGetInputSchema,
  templateListInputSchema,
  templateUpdateInputSchema,
} from "@quieter/mail/templates";
import { and, count, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import type { z } from "zod";

import { assertGrowthAccess } from "../growth-access";
import type { GrowthActor, GrowthScope } from "../growth-access";
import { hashRequest } from "../request-hash";

type TemplateRow = typeof organizationEmailTemplate.$inferSelect;
type TemplateInput = z.infer<typeof templateGetInputSchema>;

const serializeTemplate = (row: TemplateRow): EmailTemplate =>
  emailTemplateSchema.parse({
    ...row,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });

const authorizeTemplate = async (
  actor: GrowthActor,
  organizationId: string,
  scope: GrowthScope
) => {
  if (actor.organizationId !== organizationId) {
    throw new ORPCError("FORBIDDEN", {
      message: "This organization is not available to this account.",
    });
  }
  await assertGrowthAccess(actor, scope);
};

const loadTemplate = async (
  input: TemplateInput,
  database: DatabaseExecutor = db
) => {
  const [template] = await database
    .select()
    .from(organizationEmailTemplate)
    .where(
      and(
        eq(organizationEmailTemplate.organizationId, input.organizationId),
        eq(organizationEmailTemplate.id, input.templateId)
      )
    )
    .limit(1);
  if (template === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Template not found." });
  }
  return template;
};

const runTemplateOperation = async (
  database: DatabaseTransaction,
  input: { organizationId: string; idempotencyKey: string },
  operation: "create" | "duplicate",
  payload: object,
  run: () => Promise<EmailTemplate>
): Promise<EmailTemplate> => {
  const inputHash = hashRequest({ operation, payload });
  const [claimed] = await database
    .insert(organizationTemplateOperation)
    .values({
      createdAt: new Date(),
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      inputHash,
      operation,
      organizationId: input.organizationId,
    })
    .onConflictDoNothing({
      target: [
        organizationTemplateOperation.organizationId,
        organizationTemplateOperation.idempotencyKey,
      ],
    })
    .returning({ id: organizationTemplateOperation.id });
  if (claimed === undefined) {
    const [prior] = await database
      .select()
      .from(organizationTemplateOperation)
      .where(
        and(
          eq(
            organizationTemplateOperation.organizationId,
            input.organizationId
          ),
          eq(organizationTemplateOperation.idempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1);
    if (
      prior === undefined ||
      prior.inputHash !== inputHash ||
      prior.operation !== operation
    ) {
      throw new ORPCError("CONFLICT", {
        message: "This idempotency key was already used with different input.",
      });
    }
    return emailTemplateSchema.parse(prior.result);
  }
  const result = await run();
  await database
    .update(organizationTemplateOperation)
    .set({ result })
    .where(eq(organizationTemplateOperation.id, claimed.id));
  return result;
};

export const listTemplates = async (
  actor: GrowthActor,
  input: z.infer<typeof templateListInputSchema>
) => {
  await authorizeTemplate(actor, input.organizationId, "templates:read");
  const filter = and(
    eq(organizationEmailTemplate.organizationId, actor.organizationId),
    input.archived
      ? isNotNull(organizationEmailTemplate.archivedAt)
      : isNull(organizationEmailTemplate.archivedAt),
    input.search
      ? ilike(
          organizationEmailTemplate.name,
          `%${input.search.replaceAll(/[\\%_]/gu, "\\$&")}%`
        )
      : undefined
  );
  const rows = await db
    .select()
    .from(organizationEmailTemplate)
    .where(filter)
    .orderBy(
      desc(organizationEmailTemplate.updatedAt),
      desc(organizationEmailTemplate.id)
    )
    .offset(input.offset)
    .limit(input.limit);
  const [total] = await db
    .select({ count: count() })
    .from(organizationEmailTemplate)
    .where(filter);
  const totalCount = total?.count ?? 0;
  return {
    items: rows.map(serializeTemplate),
    nextOffset:
      input.offset + rows.length < totalCount
        ? input.offset + rows.length
        : null,
    totalCount,
  };
};

export const getTemplate = async (actor: GrowthActor, input: TemplateInput) => {
  await authorizeTemplate(actor, input.organizationId, "templates:read");
  return serializeTemplate(await loadTemplate(input));
};

export const createTemplate = async (
  actor: GrowthActor,
  input: z.infer<typeof templateCreateInputSchema>
) => {
  await authorizeTemplate(actor, input.organizationId, "templates:write");
  return await db.transaction(
    async (tx) =>
      await runTemplateOperation(tx, input, "create", input, async () => {
        const now = new Date();
        const [row] = await tx
          .insert(organizationEmailTemplate)
          .values({
            content: input.content,
            createdAt: now,
            id: randomUUID(),
            name: input.name,
            organizationId: actor.organizationId,
            subject: input.subject,
            updatedAt: now,
          })
          .returning();
        if (row === undefined) {
          throw new Error("Template creation failed.");
        }
        return serializeTemplate(row);
      })
  );
};

export const updateTemplate = async (
  actor: GrowthActor,
  input: z.infer<typeof templateUpdateInputSchema>
) => {
  await authorizeTemplate(actor, input.organizationId, "templates:write");
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  const [row] = await db
    .update(organizationEmailTemplate)
    .set({
      content: input.content,
      name: input.name,
      subject: input.subject,
      updatedAt: new Date(
        Math.max(Date.now(), expectedUpdatedAt.getTime() + 1)
      ),
    })
    .where(
      and(
        eq(organizationEmailTemplate.organizationId, actor.organizationId),
        eq(organizationEmailTemplate.id, input.templateId),
        eq(organizationEmailTemplate.updatedAt, expectedUpdatedAt)
      )
    )
    .returning();
  if (row === undefined) {
    throw new ORPCError("CONFLICT", {
      message: "This template changed. Reload it before saving.",
    });
  }
  return serializeTemplate(row);
};

export const archiveTemplate = async (
  actor: GrowthActor,
  input: z.infer<typeof templateArchiveInputSchema>
) => {
  await authorizeTemplate(actor, input.organizationId, "templates:write");
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  const now = new Date(Math.max(Date.now(), expectedUpdatedAt.getTime() + 1));
  const [row] = await db
    .update(organizationEmailTemplate)
    .set({
      archivedAt: input.archived ? now : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(organizationEmailTemplate.organizationId, actor.organizationId),
        eq(organizationEmailTemplate.id, input.templateId),
        eq(organizationEmailTemplate.updatedAt, expectedUpdatedAt)
      )
    )
    .returning();
  if (row === undefined) {
    throw new ORPCError("CONFLICT", {
      message: "This template changed. Reload it before saving.",
    });
  }
  return serializeTemplate(row);
};

export const duplicateTemplate = async (
  actor: GrowthActor,
  input: z.infer<typeof templateDuplicateInputSchema>
) => {
  await authorizeTemplate(actor, input.organizationId, "templates:write");
  return await db.transaction(
    async (tx) =>
      await runTemplateOperation(tx, input, "duplicate", input, async () => {
        const source = await loadTemplate(input, tx);
        const now = new Date();
        const [row] = await tx
          .insert(organizationEmailTemplate)
          .values({
            content: source.content,
            createdAt: now,
            id: randomUUID(),
            name: input.name ?? `${source.name.slice(0, 193).trimEnd()} (copy)`,
            organizationId: actor.organizationId,
            subject: source.subject,
            updatedAt: now,
          })
          .returning();
        if (row === undefined) {
          throw new Error("Template duplication failed.");
        }
        return serializeTemplate(row);
      })
  );
};

export const renderTemplate = async (
  actor: GrowthActor,
  input: TemplateInput
) => {
  await authorizeTemplate(actor, input.organizationId, "templates:read");
  const template = await loadTemplate(input);
  if (template.content.kind === "visual") {
    return exportEmailDesign(template.content.design);
  }
  return {
    ...renderEmailContent(template.content),
    document: null,
    react: null,
  };
};
