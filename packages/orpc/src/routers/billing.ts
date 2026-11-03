import {
  createBillingCheckout,
  createBillingPortal,
  getBillingOverview,
  syncBillingCheckout,
  updateAccountUsageSettings,
  takeOverOrganizationBilling,
} from "@quieter/billing";
import { billingProductIdSchema } from "@quieter/billing/plans";
import { z } from "zod";

import { getRequestHeaders } from "../context";
import { protectedProcedure } from "./base";

export const billingRouter = {
  createCheckout: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().trim().min(1).optional(),
        product: billingProductIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await createBillingCheckout({
          customerEmail: context.user.email,
          customerName: context.user.name,
          headers: getRequestHeaders(context),
          organizationId: input.organizationId,
          product: input.product,
          userId: context.userId,
        })
    ),

  createPortal: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().trim().min(1).optional(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await createBillingPortal({
          headers: getRequestHeaders(context),
          organizationId: input.organizationId,
          userId: context.userId,
        })
    ),

  overview: protectedProcedure.handler(
    async ({ context }) =>
      await getBillingOverview({
        userId: context.userId,
      })
  ),

  syncCheckout: protectedProcedure
    .input(
      z.object({
        checkoutId: z.uuid(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await syncBillingCheckout({
          checkoutId: input.checkoutId,
          userId: context.userId,
        })
    ),

  takeOverBilling: protectedProcedure
    .input(z.object({ organizationId: z.string().trim().min(1) }))
    .handler(
      async ({ context, input }) =>
        await takeOverOrganizationBilling({
          organizationId: input.organizationId,
          userId: context.userId,
        })
    ),

  updateAccountUsageSettings: protectedProcedure
    .input(
      z.object({
        monthlyOverageLimitCents: z
          .number()
          .int()
          .min(0)
          .max(Math.floor(Number.MAX_SAFE_INTEGER / 1_000_000))
          .nullable(),
        overageEnabled: z.boolean(),
      })
    )
    .handler(async ({ context, input }) => {
      await updateAccountUsageSettings({
        monthlyOverageLimitMicroCents:
          input.monthlyOverageLimitCents === null
            ? null
            : input.monthlyOverageLimitCents * 1_000_000,
        overageEnabled: input.overageEnabled,
        userId: context.userId,
      });
      return { saved: true };
    }),
};
