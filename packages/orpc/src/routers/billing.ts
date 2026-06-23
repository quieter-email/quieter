import {
  createBillingCheckout,
  createBillingPortal,
  getBillingOverview,
  syncBillingCheckout,
} from "@quieter/billing";
import { billingProductIdSchema } from "@quieter/billing/plans";
import { z } from "zod";
import { getRequestHeaders } from "../context";
import { assertUserCanManageOrganizationSettings } from "../mail-domain/service";
import { protectedProcedure } from "./base";

export const billingRouter = {
  overview: protectedProcedure.handler(
    async ({ context }) =>
      await getBillingOverview({
        userId: context.userId,
      }),
  ),

  createCheckout: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().trim().min(1),
        product: billingProductIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });

      return await createBillingCheckout({
        customerEmail: context.user.email,
        customerName: context.user.name,
        headers: getRequestHeaders(context),
        organizationId: input.organizationId,
        product: input.product,
        userId: context.userId,
      });
    }),

  createPortal: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageOrganizationSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });

      return await createBillingPortal({
        headers: getRequestHeaders(context),
        organizationId: input.organizationId,
        userId: context.userId,
      });
    }),

  syncCheckout: protectedProcedure
    .input(
      z.object({
        checkoutId: z.uuid(),
      }),
    )
    .handler(
      async ({ context, input }) =>
        await syncBillingCheckout({
          checkoutId: input.checkoutId,
          userId: context.userId,
        }),
    ),
};
