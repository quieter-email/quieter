import { createBillingCheckout, getBillingOverview } from "@quieter/billing";
import { paidBillingPlanSchema } from "@quieter/billing/plans";
import { z } from "zod";
import { getRequestHeaders } from "../context";
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
        plan: paidBillingPlanSchema,
      }),
    )
    .handler(
      async ({ context, input }) =>
        await createBillingCheckout({
          customerEmail: context.user.email,
          customerName: context.user.name,
          headers: getRequestHeaders(context),
          plan: input.plan,
          userId: context.userId,
        }),
    ),
};
