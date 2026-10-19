import { z } from "zod";

import { emailContentSchema, emailDesignSchema } from "./email-design";

const organizationInput = z.object({ organizationId: z.string().min(1) });
const templateInput = organizationInput.extend({
  templateId: z.string().min(1),
});
const fields = {
  content: emailContentSchema,
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().max(998).default(""),
};

export const templateCreateInputSchema = organizationInput.extend({
  ...fields,
  idempotencyKey: z.string().trim().min(1).max(200),
});
export const templateUpdateInputSchema = templateInput.extend({
  ...fields,
  expectedUpdatedAt: z.iso.datetime(),
});
export const templateListInputSchema = organizationInput.extend({
  archived: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  search: z.string().trim().max(200).optional(),
});
export const templateGetInputSchema = templateInput;
export const templateRenderInputSchema = templateInput;
export const templateArchiveInputSchema = templateInput.extend({
  archived: z.boolean(),
  expectedUpdatedAt: z.iso.datetime(),
});
export const templateDuplicateInputSchema = templateInput.extend({
  idempotencyKey: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200).optional(),
});
export const emailTemplateSchema = z.object({
  ...fields,
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  id: z.string(),
  organizationId: z.string(),
  updatedAt: z.iso.datetime(),
});
export const templateListResultSchema = z.object({
  items: z.array(emailTemplateSchema),
  nextOffset: z.number().nullable(),
  totalCount: z.number(),
});
export const templateRenderResultSchema = z.object({
  document: emailDesignSchema.nullable(),
  html: z.string().nullable(),
  react: z.string().nullable(),
  text: z.string(),
  warnings: z.array(z.string()),
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;
