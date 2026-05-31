import { z } from "zod";
import { createBillingCheckout, getBillingOverview } from "../billing";
import { paidBillingPlanSchema } from "../billing-plans";
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
          headers: getRequestHeaders(context),
          plan: input.plan,
          userId: context.userId,
        }),
    ),
};
