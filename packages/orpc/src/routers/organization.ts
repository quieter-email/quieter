import { z } from "zod";

import { assertUserCanManageOrganizationSettings } from "../mail-domain/service";
import {
  getOrganizationMailDeliveryMetrics,
  getOrganizationMailTrackingSettings,
  listOrganizationMailRecipientSuppressions,
  listOrganizationMailSuppressionAudit,
  reconcileOrganizationMailDeliveryRecipients,
  setOrganizationMailTrackingSettings,
  suppressOrganizationMailRecipient,
  unsuppressOrganizationMailRecipient,
} from "../organization-mail-delivery";
import {
  createOrganizationDivision,
  deleteOrganizationDivision,
  listOrganizationDivisions,
  setOrganizationDivisionMembers,
  updateOrganizationDivision,
} from "../organization/divisions";
import { protectedProcedure } from "./base";

const recipientSchema = z.string().trim().pipe(z.email().max(320));
const organizationIdSchema = z.string().trim().min(1);

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
  getMailDeliveryMetrics: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        from: z.coerce.date().optional(),
        mailboxId: z.string().trim().min(1).optional(),
        organizationId: organizationIdSchema,
        to: z.coerce.date().optional(),
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      return await getOrganizationMailDeliveryMetrics(input);
    }),
  getMailTrackingSettings: protectedProcedure
    .route({ method: "GET" })
    .input(z.object({ organizationId: organizationIdSchema }))
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      return await getOrganizationMailTrackingSettings(input);
    }),
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
        organizationId: organizationIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      return await listOrganizationMailRecipientSuppressions(input);
    }),
  listMailSuppressionAudit: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).optional(),
        organizationId: organizationIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      return await listOrganizationMailSuppressionAudit(input);
    }),
  reconcileMailMessageDelivery: protectedProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        providerMessageId: z.string().trim().min(1),
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      return await reconcileOrganizationMailDeliveryRecipients(input);
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
  setMailTrackingSettings: protectedProcedure
    .input(
      z.object({
        allowPerSendOverride: z.boolean().optional(),
        openTrackingEnabled: z.boolean().optional(),
        organizationId: organizationIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      return await setOrganizationMailTrackingSettings({
        actorUserId: context.userId,
        ...input,
      });
    }),
  suppressMailRecipient: protectedProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        recipient: recipientSchema,
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      return await suppressOrganizationMailRecipient({
        actorUserId: context.userId,
        ...input,
      });
    }),
  unsuppressMailRecipient: protectedProcedure
    .input(
      z.object({
        organizationId: organizationIdSchema,
        recipient: recipientSchema,
      })
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });
      return await unsuppressOrganizationMailRecipient({
        actorUserId: context.userId,
        ...input,
      });
    }),
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
