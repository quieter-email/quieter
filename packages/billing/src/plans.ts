import { z } from "zod";

export const PAID_BILLING_PLANS = ["managed", "pro"] as const;
export const paidBillingPlanSchema = z.enum(PAID_BILLING_PLANS);

export type PaidBillingPlan = (typeof PAID_BILLING_PLANS)[number];
