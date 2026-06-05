import { ORPCError } from "@orpc/server";
import {
  db,
  mailDomain,
  teamMailUsageAlertEvent,
  teamMailUsageEvent,
  teamMailUsageSettings,
  type TeamMailUsageAlertTarget,
  type TeamMailUsageDirection,
} from "@quieter/database";
import { and, eq, gte, lt } from "drizzle-orm";
import { getOrganizationBillingEntitlement } from "./entitlements";
import { getPolarClient, getPolarOrganizationId } from "./polar";
import {
  SES_INBOUND_CHUNK_BYTES,
  SES_INBOUND_CHUNK_MICROCENTS,
  SES_INBOUND_MESSAGE_MICROCENTS,
  SES_OUTBOUND_ATTACHMENT_DATA_MICROCENTS_PER_GB,
  SES_OUTBOUND_MESSAGE_MICROCENTS,
  TEAM_MAIL_INCLUDED_SES_USAGE_MICROCENTS,
  TEAM_MAIL_OVERAGE_MARKUP_BASIS_POINTS,
} from "./ses-pricing";

export const TEAM_MAIL_POLAR_EVENT_NAME = "quieter.team_mail.ses_overage";
export const TEAM_MAIL_USAGE_METER_KEY = "quieter_team_mail_ses_overage";

type TeamMailUsageEstimate = {
  attachmentSizeBytes: number;
  direction: TeamMailUsageDirection;
  incomingChunkCount: number;
  messageCount: number;
  messageSizeBytes: number;
  recipientCount: number;
  sesCostMicroCents: number;
};

type TeamMailUsageInput = TeamMailUsageEstimate & {
  metadata?: Record<string, string | number | boolean>;
  organizationId: string;
  providerMessageId: string;
};

export type TeamMailUsageSettings = {
  alertMilestonePercents: number[];
  monthlyOverageLimitMicroCents: number | null;
  overageEnabled: boolean;
};

let teamMailUsageMeterId: string | null = null;

export const DEFAULT_TEAM_MAIL_USAGE_SETTINGS = {
  alertMilestonePercents: [50, 80, 100],
  monthlyOverageLimitMicroCents: null,
  overageEnabled: true,
} satisfies TeamMailUsageSettings;

const getBillingPeriod = (start: Date | null, end: Date | null) => {
  if (start && end) return { end, start };

  const now = new Date();
  const calendarStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const calendarEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return { end: calendarEnd, start: calendarStart };
};

const applyOverageMarkup = (sesCostMicroCents: number) =>
  Math.ceil(sesCostMicroCents * (1 + TEAM_MAIL_OVERAGE_MARKUP_BASIS_POINTS / 10_000));

export const normalizeTeamMailAlertMilestones = (milestones: number[]) =>
  Array.from(
    new Set(
      milestones
        .map((milestone) => Math.round(milestone))
        .filter((milestone) => milestone > 0 && milestone <= 100),
    ),
  ).sort((left, right) => left - right);

export const getTeamMailUsageSettings = async (
  organizationId: string,
): Promise<TeamMailUsageSettings> => {
  const [settings] = await db
    .select({
      alertMilestonePercents: teamMailUsageSettings.alertMilestonePercents,
      monthlyOverageLimitMicroCents: teamMailUsageSettings.monthlyOverageLimitMicroCents,
      overageEnabled: teamMailUsageSettings.overageEnabled,
    })
    .from(teamMailUsageSettings)
    .where(eq(teamMailUsageSettings.organizationId, organizationId))
    .limit(1);

  const normalized = normalizeTeamMailAlertMilestones(settings?.alertMilestonePercents ?? []);

  return {
    alertMilestonePercents:
      normalized.length > 0 ? normalized : DEFAULT_TEAM_MAIL_USAGE_SETTINGS.alertMilestonePercents,
    monthlyOverageLimitMicroCents:
      settings?.monthlyOverageLimitMicroCents ??
      DEFAULT_TEAM_MAIL_USAGE_SETTINGS.monthlyOverageLimitMicroCents,
    overageEnabled: settings?.overageEnabled ?? DEFAULT_TEAM_MAIL_USAGE_SETTINGS.overageEnabled,
  };
};

export const updateTeamMailUsageSettings = async (input: {
  alertMilestonePercents: number[];
  monthlyOverageLimitMicroCents: number | null;
  organizationId: string;
  overageEnabled: boolean;
}) => {
  const now = new Date();
  const alertMilestonePercents = normalizeTeamMailAlertMilestones(input.alertMilestonePercents);
  const settings = {
    alertMilestonePercents:
      alertMilestonePercents.length > 0
        ? alertMilestonePercents
        : DEFAULT_TEAM_MAIL_USAGE_SETTINGS.alertMilestonePercents,
    monthlyOverageLimitMicroCents: input.monthlyOverageLimitMicroCents,
    overageEnabled: input.overageEnabled,
  } satisfies TeamMailUsageSettings;

  const [updatedSettings] = await db
    .insert(teamMailUsageSettings)
    .values({
      ...settings,
      createdAt: now,
      organizationId: input.organizationId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        ...settings,
        updatedAt: now,
      },
      target: teamMailUsageSettings.organizationId,
    })
    .returning({
      alertMilestonePercents: teamMailUsageSettings.alertMilestonePercents,
      monthlyOverageLimitMicroCents: teamMailUsageSettings.monthlyOverageLimitMicroCents,
      overageEnabled: teamMailUsageSettings.overageEnabled,
    });

  return updatedSettings ?? settings;
};

export const estimateOutboundTeamMailUsage = (input: {
  attachmentSizeBytes?: number;
  bcc?: string[];
  cc?: string[];
  html?: string;
  subject: string;
  text?: string;
  to: string[];
}): TeamMailUsageEstimate => {
  const recipientCount = new Set([...(input.to ?? []), ...(input.cc ?? []), ...(input.bcc ?? [])])
    .size;
  const messageSizeBytes = Buffer.byteLength(
    `${input.subject}\n${input.text ?? ""}\n${input.html ?? ""}`,
    "utf8",
  );
  const attachmentSizeBytes = input.attachmentSizeBytes ?? 0;
  const attachmentDataCostMicroCents =
    (attachmentSizeBytes / 1_073_741_824) * SES_OUTBOUND_ATTACHMENT_DATA_MICROCENTS_PER_GB;

  return {
    attachmentSizeBytes,
    direction: "outbound",
    incomingChunkCount: 0,
    messageCount: recipientCount,
    messageSizeBytes,
    recipientCount,
    sesCostMicroCents: Math.ceil(
      recipientCount * SES_OUTBOUND_MESSAGE_MICROCENTS + attachmentDataCostMicroCents,
    ),
  };
};

export const estimateInboundTeamMailUsage = (input: {
  messageSizeBytes: number;
  recipientCount: number;
}): TeamMailUsageEstimate => {
  const incomingChunkCount =
    input.messageSizeBytes > 0 ? Math.ceil(input.messageSizeBytes / SES_INBOUND_CHUNK_BYTES) : 0;

  return {
    attachmentSizeBytes: 0,
    direction: "inbound",
    incomingChunkCount,
    messageCount: 1,
    messageSizeBytes: input.messageSizeBytes,
    recipientCount: input.recipientCount,
    sesCostMicroCents:
      SES_INBOUND_MESSAGE_MICROCENTS + incomingChunkCount * SES_INBOUND_CHUNK_MICROCENTS,
  };
};

const getPeriodUsageMicroCents = async (input: {
  end: Date;
  organizationId: string;
  start: Date;
}) => {
  const rows = await db
    .select({
      billableCostMicroCents: teamMailUsageEvent.billableCostMicroCents,
      sesCostMicroCents: teamMailUsageEvent.sesCostMicroCents,
    })
    .from(teamMailUsageEvent)
    .where(
      and(
        eq(teamMailUsageEvent.organizationId, input.organizationId),
        gte(teamMailUsageEvent.createdAt, input.start),
        lt(teamMailUsageEvent.createdAt, input.end),
      ),
    );

  return rows.reduce(
    (totals, row) => ({
      billableCostMicroCents: totals.billableCostMicroCents + row.billableCostMicroCents,
      sesCostMicroCents: totals.sesCostMicroCents + row.sesCostMicroCents,
    }),
    { billableCostMicroCents: 0, sesCostMicroCents: 0 },
  );
};

const getEventOverage = (input: {
  estimate: TeamMailUsageEstimate;
  usedSesCostMicroCents: number;
}) => {
  const remainingIncludedSesCostMicroCents = Math.max(
    0,
    TEAM_MAIL_INCLUDED_SES_USAGE_MICROCENTS - input.usedSesCostMicroCents,
  );
  const overageSesCostMicroCents = Math.max(
    0,
    input.estimate.sesCostMicroCents - remainingIncludedSesCostMicroCents,
  );

  return {
    billableCostMicroCents: applyOverageMarkup(overageSesCostMicroCents),
    overageSesCostMicroCents,
    remainingIncludedSesCostMicroCents,
  };
};

const applyTeamMailUsageSettings = (input: {
  billableCostMicroCents: number;
  currentBillableCostMicroCents: number;
  settings: TeamMailUsageSettings;
}) => {
  if (!input.settings.overageEnabled) return 0;

  if (input.settings.monthlyOverageLimitMicroCents == null) {
    return input.billableCostMicroCents;
  }

  const remainingBillableCostMicroCents = Math.max(
    0,
    input.settings.monthlyOverageLimitMicroCents - input.currentBillableCostMicroCents,
  );

  return Math.min(input.billableCostMicroCents, remainingBillableCostMicroCents);
};

const getTeamMailUsageMeterId = async () => {
  if (teamMailUsageMeterId) return teamMailUsageMeterId;

  const polar = await getPolarClient();
  const organizationId = getPolarOrganizationId();
  const meters = await polar.meters.list({
    limit: 100,
    metadata: {
      quieterMeter: TEAM_MAIL_USAGE_METER_KEY,
    },
    organizationId,
  });
  const existingMeter = meters.result.items.find(
    (meter) => meter.metadata.quieterMeter === TEAM_MAIL_USAGE_METER_KEY,
  );

  if (existingMeter) {
    teamMailUsageMeterId = existingMeter.id;
    return existingMeter.id;
  }

  const createdMeter = await polar.meters.create({
    aggregation: {
      func: "sum",
      property: "billableCostCents",
    },
    filter: {
      clauses: [
        {
          operator: "eq",
          property: "name",
          value: TEAM_MAIL_POLAR_EVENT_NAME,
        },
      ],
      conjunction: "and",
    },
    metadata: {
      quieterMeter: TEAM_MAIL_USAGE_METER_KEY,
    },
    name: "Quieter team mail SES overage",
    organizationId,
  });

  teamMailUsageMeterId = createdMeter.id;
  return createdMeter.id;
};

export const getTeamMailMeteredPrice = async () => ({
  amountType: "metered_unit" as const,
  meterId: await getTeamMailUsageMeterId(),
  priceCurrency: "usd",
  unitAmount: "1",
});

const recordTeamMailUsageAlerts = async (input: {
  organizationId: string;
  period: { end: Date; start: Date };
  settings: TeamMailUsageSettings;
  usage: {
    billableCostMicroCents: number;
    sesCostMicroCents: number;
  };
}) => {
  type AlertCandidate = {
    target: TeamMailUsageAlertTarget;
    thresholdMicroCents: number;
  };

  const alerts = input.settings.alertMilestonePercents.flatMap((milestonePercent) => {
    const includedUsageThreshold = Math.ceil(
      TEAM_MAIL_INCLUDED_SES_USAGE_MICROCENTS * (milestonePercent / 100),
    );
    const includedUsageAlert: AlertCandidate[] =
      input.usage.sesCostMicroCents >= includedUsageThreshold
        ? [
            {
              target: "included_usage",
              thresholdMicroCents: includedUsageThreshold,
            },
          ]
        : [];
    const overageLimitThreshold =
      input.settings.monthlyOverageLimitMicroCents == null
        ? null
        : Math.ceil(input.settings.monthlyOverageLimitMicroCents * (milestonePercent / 100));
    const overageLimitAlert: AlertCandidate[] =
      overageLimitThreshold != null && input.usage.billableCostMicroCents >= overageLimitThreshold
        ? [
            {
              target: "overage_limit",
              thresholdMicroCents: overageLimitThreshold,
            },
          ]
        : [];

    return [...includedUsageAlert, ...overageLimitAlert].map((alert) => ({
      ...alert,
      createdAt: new Date(),
      id: crypto.randomUUID(),
      milestonePercent,
      organizationId: input.organizationId,
      periodEnd: input.period.end,
      periodStart: input.period.start,
      target: alert.target,
      usageMicroCents:
        alert.target === "included_usage"
          ? input.usage.sesCostMicroCents
          : input.usage.billableCostMicroCents,
    }));
  });

  if (alerts.length === 0) return;

  await db
    .insert(teamMailUsageAlertEvent)
    .values(alerts)
    .onConflictDoNothing({
      target: [
        teamMailUsageAlertEvent.organizationId,
        teamMailUsageAlertEvent.periodStart,
        teamMailUsageAlertEvent.target,
        teamMailUsageAlertEvent.milestonePercent,
      ],
    });
};

export const assertCanConsumeTeamMailUsage = async (input: {
  estimate: TeamMailUsageEstimate;
  organizationId: string;
}) => {
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "teamMail",
    organizationId: input.organizationId,
  });

  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: "Team mail API sending requires the managed plan.",
      status: 403,
    });
  }

  const period = getBillingPeriod(entitlement.currentPeriodStart, entitlement.currentPeriodEnd);
  const usage = await getPeriodUsageMicroCents({
    end: period.end,
    organizationId: input.organizationId,
    start: period.start,
  });
  const eventOverage = getEventOverage({
    estimate: input.estimate,
    usedSesCostMicroCents: usage.sesCostMicroCents,
  });

  if (eventOverage.overageSesCostMicroCents > 0 && !entitlement.hasUnlimitedAccess) {
    const settings = await getTeamMailUsageSettings(input.organizationId);
    const projectedBillableCostMicroCents =
      usage.billableCostMicroCents + eventOverage.billableCostMicroCents;

    if (!settings.overageEnabled) {
      throw new ORPCError("FORBIDDEN", {
        message: "Team mail SES overage is disabled for this team.",
        status: 403,
      });
    }

    if (
      settings.monthlyOverageLimitMicroCents != null &&
      projectedBillableCostMicroCents > settings.monthlyOverageLimitMicroCents
    ) {
      throw new ORPCError("FORBIDDEN", {
        message: "Team mail SES overage limit reached for this billing period.",
        status: 403,
      });
    }
  }

  if (
    eventOverage.overageSesCostMicroCents > 0 &&
    !entitlement.hasUnlimitedAccess &&
    !entitlement.billingUserId
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "Team mail SES overage billing is not available for this team.",
      status: 403,
    });
  }

  if (eventOverage.overageSesCostMicroCents > 0 && !entitlement.hasUnlimitedAccess) {
    await getTeamMailUsageMeterId();
  }

  return { entitlement, period };
};

export const recordTeamMailUsage = async (input: TeamMailUsageInput) => {
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "teamMail",
    organizationId: input.organizationId,
  });

  if (!entitlement.hasAccess) return null;

  const period = getBillingPeriod(entitlement.currentPeriodStart, entitlement.currentPeriodEnd);
  const usage = await getPeriodUsageMicroCents({
    end: period.end,
    organizationId: input.organizationId,
    start: period.start,
  });
  const eventOverage = getEventOverage({
    estimate: input,
    usedSesCostMicroCents: usage.sesCostMicroCents,
  });
  const includedSesCostMicroCents = entitlement.hasUnlimitedAccess
    ? input.sesCostMicroCents
    : Math.min(input.sesCostMicroCents, eventOverage.remainingIncludedSesCostMicroCents);
  const settings = entitlement.hasUnlimitedAccess
    ? DEFAULT_TEAM_MAIL_USAGE_SETTINGS
    : await getTeamMailUsageSettings(input.organizationId);
  const rawBillableCostMicroCents = entitlement.hasUnlimitedAccess
    ? 0
    : eventOverage.billableCostMicroCents;
  const billableCostMicroCents = entitlement.hasUnlimitedAccess
    ? 0
    : applyTeamMailUsageSettings({
        billableCostMicroCents: rawBillableCostMicroCents,
        currentBillableCostMicroCents: usage.billableCostMicroCents,
        settings,
      });
  const now = new Date();
  const dedupeKey = `${input.direction}:${input.organizationId}:${input.providerMessageId}`;
  const [usageEvent] = await db
    .insert(teamMailUsageEvent)
    .values({
      attachmentSizeBytes: input.attachmentSizeBytes,
      billableCostMicroCents,
      createdAt: now,
      dedupeKey,
      direction: input.direction,
      id: crypto.randomUUID(),
      includedSesCostMicroCents,
      incomingChunkCount: input.incomingChunkCount,
      messageCount: input.messageCount,
      messageSizeBytes: input.messageSizeBytes,
      metadata: input.metadata ?? {},
      organizationId: input.organizationId,
      provider: "ses",
      providerMessageId: input.providerMessageId,
      recipientCount: input.recipientCount,
      sesCostMicroCents: input.sesCostMicroCents,
    })
    .onConflictDoNothing({ target: teamMailUsageEvent.dedupeKey })
    .returning({
      id: teamMailUsageEvent.id,
    });

  if (usageEvent && !entitlement.hasUnlimitedAccess) {
    await recordTeamMailUsageAlerts({
      organizationId: input.organizationId,
      period,
      settings,
      usage: {
        billableCostMicroCents: usage.billableCostMicroCents + billableCostMicroCents,
        sesCostMicroCents: usage.sesCostMicroCents + input.sesCostMicroCents,
      },
    });
  }

  if (!usageEvent || billableCostMicroCents <= 0 || !entitlement.billingUserId) {
    return usageEvent ?? null;
  }

  await getTeamMailUsageMeterId();
  await (
    await getPolarClient()
  ).events.ingest({
    events: [
      {
        externalCustomerId: `user:${entitlement.billingUserId}`,
        metadata: {
          billableCostCents: billableCostMicroCents / 1_000_000,
          direction: input.direction,
          organizationId: input.organizationId,
          providerMessageId: input.providerMessageId,
          sesCostCents: input.sesCostMicroCents / 1_000_000,
          usageEventId: usageEvent.id,
        },
        name: TEAM_MAIL_POLAR_EVENT_NAME,
        organizationId: getPolarOrganizationId(),
        timestamp: now,
      },
    ],
  });

  await db
    .update(teamMailUsageEvent)
    .set({ polarEventReportedAt: new Date() })
    .where(eq(teamMailUsageEvent.id, usageEvent.id));

  return usageEvent;
};

export const getTeamMailUsageOverview = async (organizationId: string) => {
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "teamMail",
    organizationId,
  });
  const period = getBillingPeriod(entitlement.currentPeriodStart, entitlement.currentPeriodEnd);
  const [settings, usage] = await Promise.all([
    getTeamMailUsageSettings(organizationId),
    getPeriodUsageMicroCents({
      end: period.end,
      organizationId,
      start: period.start,
    }),
  ]);

  return {
    hasAccess: entitlement.hasAccess,
    hasUnlimitedAccess: entitlement.hasUnlimitedAccess,
    includedSesUsageMicroCents: TEAM_MAIL_INCLUDED_SES_USAGE_MICROCENTS,
    period,
    remainingIncludedSesUsageMicroCents: entitlement.hasUnlimitedAccess
      ? null
      : Math.max(0, TEAM_MAIL_INCLUDED_SES_USAGE_MICROCENTS - usage.sesCostMicroCents),
    settings,
    usage,
  };
};

export const recordInboundTeamMailUsage = async (input: {
  messageSizeBytes: number;
  providerMessageId: string;
  recipients: string[];
}) => {
  const normalizedRecipients = Array.from(
    new Set(input.recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean)),
  );
  const domains = Array.from(
    new Set(normalizedRecipients.map((recipient) => recipient.split("@").at(1)).filter(Boolean)),
  );

  if (domains.length === 0) return;

  const domainRows = await db
    .select({
      domain: mailDomain.domain,
      organizationId: mailDomain.organizationId,
    })
    .from(mailDomain)
    .where(eq(mailDomain.status, "verified"));
  const organizationIds = new Set(
    domainRows.filter((row) => domains.includes(row.domain)).map((row) => row.organizationId),
  );

  await Promise.all(
    Array.from(organizationIds).map(async (organizationId) => {
      const orgDomains = new Set(
        domainRows.filter((row) => row.organizationId === organizationId).map((row) => row.domain),
      );
      const orgRecipients = normalizedRecipients.filter((recipient) => {
        const domain = recipient.split("@").at(1);
        return domain != null && orgDomains.has(domain);
      });

      if (orgRecipients.length === 0) return;

      const estimate = estimateInboundTeamMailUsage({
        messageSizeBytes: input.messageSizeBytes,
        recipientCount: orgRecipients.length,
      });

      await recordTeamMailUsage({
        ...estimate,
        metadata: {
          recipients: orgRecipients.join(","),
        },
        organizationId,
        providerMessageId: input.providerMessageId,
      });
    }),
  );
};
