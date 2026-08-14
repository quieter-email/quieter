import { z } from "zod";

import { assertUserCanManageOrganizationSettings } from "../mail-domain/service";
import { listOrganizationMailRecipientSuppressions } from "../organization-mail-delivery";
import {
  createOrganizationDivision,
  deleteOrganizationDivision,
  listOrganizationDivisions,
  setOrganizationDivisionMembers,
  updateOrganizationDivision,
} from "../organization/divisions";
import { protectedProcedure } from "./base";

export const organizationRouter = {
  createDivision: protectedProcedure
    .input(
      z.object({
        description: z.string().trim().max(500).nullable().optional(),
        name: z.string().trim().min(1).max(80),
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(
      async ({ context, input }) =>
        await createOrganizationDivision({ ...input, userId: context.userId })
    ),
  deleteDivision: protectedProcedure
    .input(z.object({ divisionId: z.string().trim().min(1) }))
    .handler(
      async ({ context, input }) =>
        await deleteOrganizationDivision({ ...input, userId: context.userId })
    ),
  listDivisions: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ organizationId: z.string().trim().min(1) }))
    .handler(
      async ({ context, input }) =>
        await listOrganizationDivisions({ ...input, userId: context.userId })
    ),
  listMailRecipientSuppressions: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).optional(),
        organizationId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      return await listOrganizationMailRecipientSuppressions(input);
    }),
  setDivisionMembers: protectedProcedure
    .input(
      z.object({
        divisionId: z.string().trim().min(1),
        memberIds: z.array(z.string().trim().min(1)).max(500),
      })
    )
    .handler(
      async ({ context, input }) =>
        await setOrganizationDivisionMembers({
          ...input,
          userId: context.userId,
        })
    ),
  updateDivision: protectedProcedure
    .input(
      z.object({
        description: z.string().trim().max(500).nullable().optional(),
        divisionId: z.string().trim().min(1),
        name: z.string().trim().min(1).max(80).optional(),
        position: z.number().int().nonnegative().optional(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await updateOrganizationDivision({ ...input, userId: context.userId })
    ),
};
