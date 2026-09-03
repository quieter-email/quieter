import { mailboxSavedViewDefinitionSchema } from "@quieter/mail/mailbox-organization";
import { z } from "zod";

import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  reorderSavedViews,
  updateSavedView,
} from "../../saved-views/service";
import { mailboxIdSchema, protectedProcedure } from "../base";

const createSavedViewProcedure = protectedProcedure
  .input(
    z.object({
      definition: mailboxSavedViewDefinitionSchema,
      mailboxId: mailboxIdSchema,
      shared: z.boolean(),
    })
  )
  .handler(
    async ({ context, input }) =>
      await createSavedView({ ...input, userId: context.userId })
  );
const deleteSavedViewProcedure = protectedProcedure
  .input(
    z.object({ mailboxId: mailboxIdSchema, viewId: z.string().trim().min(1) })
  )
  .handler(
    async ({ context, input }) =>
      await deleteSavedView({ ...input, userId: context.userId })
  );
const listSavedViewsProcedure = protectedProcedure
  .route({ method: "GET" })
  .input(z.object({ mailboxId: mailboxIdSchema }))
  .handler(
    async ({ context, input }) =>
      await listSavedViews({ ...input, userId: context.userId })
  );
const reorderSavedViewsProcedure = protectedProcedure
  .input(
    z.object({
      mailboxId: mailboxIdSchema,
      viewIds: z
        .array(z.string().trim().min(1))
        .refine((viewIds) => new Set(viewIds).size === viewIds.length, {
          message: "Saved view IDs must be unique.",
        }),
    })
  )
  .handler(
    async ({ context, input }) =>
      await reorderSavedViews({ ...input, userId: context.userId })
  );
const updateSavedViewProcedure = protectedProcedure
  .input(
    z.object({
      definition: mailboxSavedViewDefinitionSchema,
      mailboxId: mailboxIdSchema,
      viewId: z.string().trim().min(1),
    })
  )
  .handler(
    async ({ context, input }) =>
      await updateSavedView({ ...input, userId: context.userId })
  );

export const mailboxSavedViewRouter = {
  // Preserve the shipped names while frontend and backend releases overlap.
  createManagedSavedView: createSavedViewProcedure,
  createSavedView: createSavedViewProcedure,
  deleteManagedSavedView: deleteSavedViewProcedure,
  deleteSavedView: deleteSavedViewProcedure,
  listManagedSavedViews: listSavedViewsProcedure,
  listSavedViews: listSavedViewsProcedure,
  reorderManagedSavedViews: reorderSavedViewsProcedure,
  reorderSavedViews: reorderSavedViewsProcedure,
  updateManagedSavedView: updateSavedViewProcedure,
  updateSavedView: updateSavedViewProcedure,
};
