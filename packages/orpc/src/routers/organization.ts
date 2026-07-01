import { z } from "zod";
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
      }),
    )
    .handler(async ({ context, input }) =>
      createOrganizationDivision({ ...input, userId: context.userId }),
    ),
  deleteDivision: protectedProcedure
    .input(z.object({ divisionId: z.string().trim().min(1) }))
    .handler(async ({ context, input }) =>
      deleteOrganizationDivision({ ...input, userId: context.userId }),
    ),
  listDivisions: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ organizationId: z.string().trim().min(1) }))
    .handler(async ({ context, input }) =>
      listOrganizationDivisions({ ...input, userId: context.userId }),
    ),
  setDivisionMembers: protectedProcedure
    .input(
      z.object({
        divisionId: z.string().trim().min(1),
        memberIds: z.array(z.string().trim().min(1)).max(500),
      }),
    )
    .handler(async ({ context, input }) =>
      setOrganizationDivisionMembers({ ...input, userId: context.userId }),
    ),
  updateDivision: protectedProcedure
    .input(
      z.object({
        description: z.string().trim().max(500).nullable().optional(),
        divisionId: z.string().trim().min(1),
        name: z.string().trim().min(1).max(80).optional(),
        position: z.number().int().nonnegative().optional(),
      }),
    )
    .handler(async ({ context, input }) =>
      updateOrganizationDivision({ ...input, userId: context.userId }),
    ),
};
