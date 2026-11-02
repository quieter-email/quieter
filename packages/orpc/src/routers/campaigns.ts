import {
  campaignCancelInputSchema,
  campaignCreateInputSchema,
  campaignDetailResultSchema,
  campaignGetInputSchema,
  campaignListInputSchema,
  campaignListResultSchema,
  campaignPreviewInputSchema,
  campaignPreviewResultSchema,
  campaignRetryInputSchema,
  campaignSchema,
  campaignSendInputSchema,
  campaignUpdateInputSchema,
} from "@quieter/mail/campaigns";

import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  previewCampaign,
  sendCampaign,
  cancelCampaign,
  retryCampaign,
} from "../campaigns/service";
import { protectedProcedure } from "./base";

export const campaignsRouter = {
  cancel: protectedProcedure
    .input(campaignCancelInputSchema)
    .output(campaignSchema)
    .handler(
      async ({ context, input }) =>
        await cancelCampaign(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  create: protectedProcedure
    .input(campaignCreateInputSchema)
    .output(campaignSchema)
    .handler(
      async ({ context, input }) =>
        await createCampaign(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  get: protectedProcedure
    .input(campaignGetInputSchema)
    .output(campaignDetailResultSchema)
    .handler(
      async ({ context, input }) =>
        await getCampaign(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  list: protectedProcedure
    .input(campaignListInputSchema)
    .output(campaignListResultSchema)
    .handler(
      async ({ context, input }) =>
        await listCampaigns(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  preview: protectedProcedure
    .input(campaignPreviewInputSchema)
    .output(campaignPreviewResultSchema)
    .handler(
      async ({ context, input }) =>
        await previewCampaign(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  retry: protectedProcedure
    .input(campaignRetryInputSchema)
    .output(campaignSchema)
    .handler(
      async ({ context, input }) =>
        await retryCampaign(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  send: protectedProcedure
    .input(campaignSendInputSchema)
    .output(campaignSchema)
    .handler(
      async ({ context, input }) =>
        await sendCampaign(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
  update: protectedProcedure
    .input(campaignUpdateInputSchema)
    .output(campaignSchema)
    .handler(
      async ({ context, input }) =>
        await updateCampaign(
          { organizationId: input.organizationId, userId: context.userId },
          input
        )
    ),
};
