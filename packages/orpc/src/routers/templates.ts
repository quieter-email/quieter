import {
  emailTemplateSchema,
  templateArchiveInputSchema,
  templateCreateInputSchema,
  templateDuplicateInputSchema,
  templateGetInputSchema,
  templateListInputSchema,
  templateListResultSchema,
  templateRenderInputSchema,
  templateRenderResultSchema,
  templateUpdateInputSchema,
} from "@quieter/mail/templates";

import {
  archiveTemplate,
  createTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  renderTemplate,
  updateTemplate,
} from "../templates/service";
import { protectedProcedure } from "./base";

export const templatesRouter = {
  archive: protectedProcedure
    .input(templateArchiveInputSchema)
    .output(emailTemplateSchema)
    .handler(
      async ({ context, input }) =>
        await archiveTemplate(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  create: protectedProcedure
    .input(templateCreateInputSchema)
    .output(emailTemplateSchema)
    .handler(
      async ({ context, input }) =>
        await createTemplate(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  duplicate: protectedProcedure
    .input(templateDuplicateInputSchema)
    .output(emailTemplateSchema)
    .handler(
      async ({ context, input }) =>
        await duplicateTemplate(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  get: protectedProcedure
    .input(templateGetInputSchema)
    .output(emailTemplateSchema)
    .handler(
      async ({ context, input }) =>
        await getTemplate(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  list: protectedProcedure
    .input(templateListInputSchema)
    .output(templateListResultSchema)
    .handler(
      async ({ context, input }) =>
        await listTemplates(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  render: protectedProcedure
    .input(templateRenderInputSchema)
    .output(templateRenderResultSchema)
    .handler(
      async ({ context, input }) =>
        await renderTemplate(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  update: protectedProcedure
    .input(templateUpdateInputSchema)
    .output(emailTemplateSchema)
    .handler(
      async ({ context, input }) =>
        await updateTemplate(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
};
