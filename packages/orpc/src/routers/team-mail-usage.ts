import {
  getTeamMailUsageOverview,
  updateTeamMailUsageSettings,
} from "@quieter/billing/team-mail-usage";
import { z } from "zod";
import { assertUserCanManageTeamSettings, assertUserOrganizationMember } from "../mail-domain";
import { protectedProcedure } from "./base";

const microCentsPerCent = 1_000_000;

const toCents = (microCents: number | null) =>
  microCents == null ? null : Math.ceil(microCents / microCentsPerCent);

const toMicroCents = (cents: number | null) =>
  cents == null ? null : Math.round(cents * microCentsPerCent);

const serializeOverview = async (organizationId: string) => {
  const overview = await getTeamMailUsageOverview(organizationId);

  return {
    hasAccess: overview.hasAccess,
    hasUnlimitedAccess: overview.hasUnlimitedAccess,
    includedSesUsageCents: toCents(overview.includedSesUsageMicroCents),
    period: {
      end: overview.period.end.toISOString(),
      start: overview.period.start.toISOString(),
    },
    remainingIncludedSesUsageCents: toCents(overview.remainingIncludedSesUsageMicroCents),
    settings: {
      alertMilestonePercents: overview.settings.alertMilestonePercents,
      monthlyOverageLimitCents: toCents(overview.settings.monthlyOverageLimitMicroCents),
      overageEnabled: overview.settings.overageEnabled,
    },
    usage: {
      billableCostCents: toCents(overview.usage.billableCostMicroCents),
      sesCostCents: toCents(overview.usage.sesCostMicroCents),
    },
  };
};

export const teamMailUsageRouter = {
  overview: protectedProcedure
    .route({ method: "GET" })
    .input(
      z.object({
        organizationId: z.string().trim().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertUserOrganizationMember({
        organizationId: input.organizationId,
        userId: context.userId,
      });

      return await serializeOverview(input.organizationId);
    }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        alertMilestonePercents: z.array(z.number().int().min(1).max(100)).min(1).max(10),
        monthlyOverageLimitCents: z.number().int().min(0).nullable(),
        organizationId: z.string().trim().min(1),
        overageEnabled: z.boolean(),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertUserCanManageTeamSettings({
        organizationId: input.organizationId,
        userId: context.userId,
      });

      await updateTeamMailUsageSettings({
        alertMilestonePercents: input.alertMilestonePercents,
        monthlyOverageLimitMicroCents: toMicroCents(input.monthlyOverageLimitCents),
        organizationId: input.organizationId,
        overageEnabled: input.overageEnabled,
      });

      return await serializeOverview(input.organizationId);
    }),
};
