import { ORPCError } from "@orpc/server";
import {
  createBillingCheckout,
  createBillingPortal,
  getBillingOverview,
  syncBillingCheckout,
} from "@quieter/billing";
import { BILLING_PRODUCTS, billingProductIdSchema } from "@quieter/billing/plans";
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
        organizationId: z.string().trim().min(1).optional(),
        product: billingProductIdSchema,
      }),
    )
    .handler(async ({ context, input }) => {
      if (BILLING_PRODUCTS[input.product].scope === "team") {
        if (!input.organizationId) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Choose an organization for team billing.",
          });
        }

        await assertUserCanManageOrganizationSettings({
          organizationId: input.organizationId,
          userId: context.userId,
        });
      }

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
        organizationId: z.string().trim().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.organizationId) {
        await assertUserCanManageOrganizationSettings({
          organizationId: input.organizationId,
          userId: context.userId,
        });
      }

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
