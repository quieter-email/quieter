import { ORPCError } from "@orpc/server";
import {
  db,
  mailDomain,
  organizationMailUsageAlertEvent,
  organizationMailUsageEvent,
  organizationMailUsageSettings,
  type OrganizationMailUsageAlertTarget,
  type OrganizationMailUsageDirection,
} from "@quieter/database";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { PaidBillingPlan } from "./plans";
import { getOrganizationBillingEntitlement } from "./entitlements";
import { getPolarApiOrganizationId, getPolarClient, ingestPolarEvents } from "./polar";
import {
  getManagedUsageMarkupBasisPoints,
  getManagedUsageRates,
  SES_INBOUND_CHUNK_BYTES,
  SES_INBOUND_CHUNK_MICROCENTS,
  SES_INBOUND_MESSAGE_MICROCENTS,
  SES_OUTBOUND_ATTACHMENT_DATA_MICROCENTS_PER_GB,
  SES_OUTBOUND_MESSAGE_MICROCENTS,
  ORGANIZATION_MAIL_INCLUDED_SES_USAGE_MICROCENTS,
} from "./ses-pricing";

export const ORGANIZATION_MAIL_POLAR_EVENT_NAME = "quieter.organization_mail.ses_overage";
export const ORGANIZATION_MAIL_USAGE_METER_KEY = "quieter_organization_mail_ses_overage";

type OrganizationMailUsageEstimate = {
  attachmentSizeBytes: number;
  direction: OrganizationMailUsageDirection;
  incomingChunkCount: number;
  messageCount: number;
  messageSizeBytes: number;
  recipientCount: number;
  sesCostMicroCents: number;
};

type OrganizationMailUsageInput = OrganizationMailUsageEstimate & {
  metadata?: Record<string, string | number | boolean>;
  organizationId: string;
  providerMessageId: string;
};

export type OrganizationMailUsageSettings = {
  alertMilestonePercents: number[];
  monthlyOverageLimitMicroCents: number | null;
  overageEnabled: boolean;
};

let organizationMailUsageMeterId: string | null = null;

export const DEFAULT_ORGANIZATION_MAIL_USAGE_SETTINGS = {
  alertMilestonePercents: [50, 80, 100],
  monthlyOverageLimitMicroCents: null,
  overageEnabled: true,
} satisfies OrganizationMailUsageSettings;

const getBillingPeriod = (start: Date | null, end: Date | null) => {
  if (start && end) return { end, start };

  const now = new Date();
  const calendarStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const calendarEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return { end: calendarEnd, start: calendarStart };
};

const applyOverageMarkup = (sesCostMicroCents: number, plan: PaidBillingPlan | null) =>
  Math.ceil(sesCostMicroCents * (1 + getManagedUsageMarkupBasisPoints(plan) / 10_000));

export const withOrganizationMailUsageLock = async <T>(
  organizationId: string,
  callback: () => Promise<T>,
) => {
  const connection = await db.$client.reserve();
  let locked = false;
  try {
    await connection`select pg_advisory_lock(hashtextextended(${organizationId}, 0))`;
    locked = true;
    return await callback();
  } finally {
    if (locked) {
      await connection`select pg_advisory_unlock(hashtextextended(${organizationId}, 0))`;
    }
    connection.release();
  }
};

export const normalizeOrganizationMailAlertMilestones = (milestones: number[]) =>
  Array.from(
    new Set(
      milestones
        .map((milestone) => Math.round(milestone))
        .filter((milestone) => milestone > 0 && milestone <= 100),
    ),
  ).sort((left, right) => left - right);

export const getOrganizationMailUsageSettings = async (
  organizationId: string,
): Promise<OrganizationMailUsageSettings> => {
  const [settings] = await db
    .select({
      alertMilestonePercents: organizationMailUsageSettings.alertMilestonePercents,
      monthlyOverageLimitMicroCents: organizationMailUsageSettings.monthlyOverageLimitMicroCents,
      overageEnabled: organizationMailUsageSettings.overageEnabled,
    })
    .from(organizationMailUsageSettings)
    .where(eq(organizationMailUsageSettings.organizationId, organizationId))
    .limit(1);

  const normalized = normalizeOrganizationMailAlertMilestones(
    settings?.alertMilestonePercents ?? [],
  );

  return {
    alertMilestonePercents:
      normalized.length > 0
        ? normalized
        : DEFAULT_ORGANIZATION_MAIL_USAGE_SETTINGS.alertMilestonePercents,
    monthlyOverageLimitMicroCents:
      settings?.monthlyOverageLimitMicroCents ??
      DEFAULT_ORGANIZATION_MAIL_USAGE_SETTINGS.monthlyOverageLimitMicroCents,
    overageEnabled:
      settings?.overageEnabled ?? DEFAULT_ORGANIZATION_MAIL_USAGE_SETTINGS.overageEnabled,
  };
};

export const updateOrganizationMailUsageSettings = async (input: {
  alertMilestonePercents: number[];
  monthlyOverageLimitMicroCents: number | null;
  organizationId: string;
  overageEnabled: boolean;
}) => {
  const now = new Date();
  const alertMilestonePercents = normalizeOrganizationMailAlertMilestones(
    input.alertMilestonePercents,
  );
  const settings = {
    alertMilestonePercents:
      alertMilestonePercents.length > 0
        ? alertMilestonePercents
        : DEFAULT_ORGANIZATION_MAIL_USAGE_SETTINGS.alertMilestonePercents,
    monthlyOverageLimitMicroCents: input.monthlyOverageLimitMicroCents,
    overageEnabled: input.overageEnabled,
  } satisfies OrganizationMailUsageSettings;

  const [updatedSettings] = await db
    .insert(organizationMailUsageSettings)
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
      target: organizationMailUsageSettings.organizationId,
    })
    .returning({
      alertMilestonePercents: organizationMailUsageSettings.alertMilestonePercents,
      monthlyOverageLimitMicroCents: organizationMailUsageSettings.monthlyOverageLimitMicroCents,
      overageEnabled: organizationMailUsageSettings.overageEnabled,
    });

  return updatedSettings ?? settings;
};

export const estimateOutboundOrganizationMailUsage = (input: {
  attachmentSizeBytes?: number;
  bcc?: string[];
  cc?: string[];
  html?: string;
  subject: string;
  text?: string;
  to: string[];
}): OrganizationMailUsageEstimate => {
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

export const estimateInboundOrganizationMailUsage = (input: {
  messageSizeBytes: number;
  recipientCount: number;
}): OrganizationMailUsageEstimate => {
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
  const [usage] = await db
    .select({
      billableCostMicroCents: sql<number>`coalesce(sum(${organizationMailUsageEvent.billableCostMicroCents}), 0)`,
      sesCostMicroCents: sql<number>`coalesce(sum(${organizationMailUsageEvent.sesCostMicroCents}), 0)`,
    })
    .from(organizationMailUsageEvent)
    .where(
      and(
        eq(organizationMailUsageEvent.organizationId, input.organizationId),
        gte(organizationMailUsageEvent.createdAt, input.start),
        lt(organizationMailUsageEvent.createdAt, input.end),
      ),
    )
    .limit(1);

  return {
    billableCostMicroCents: Number(usage?.billableCostMicroCents ?? 0),
    sesCostMicroCents: Number(usage?.sesCostMicroCents ?? 0),
  };
};

const getEventOverage = (input: {
  estimate: OrganizationMailUsageEstimate;
  plan: PaidBillingPlan | null;
  usedSesCostMicroCents: number;
}) => {
  const remainingIncludedSesCostMicroCents = Math.max(
    0,
    ORGANIZATION_MAIL_INCLUDED_SES_USAGE_MICROCENTS - input.usedSesCostMicroCents,
  );
  const overageSesCostMicroCents = Math.max(
    0,
    input.estimate.sesCostMicroCents - remainingIncludedSesCostMicroCents,
  );

  return {
    billableCostMicroCents: applyOverageMarkup(overageSesCostMicroCents, input.plan),
    overageSesCostMicroCents,
    remainingIncludedSesCostMicroCents,
  };
};

const applyOrganizationMailUsageSettings = (input: {
  billableCostMicroCents: number;
  currentBillableCostMicroCents: number;
  settings: OrganizationMailUsageSettings;
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

const getOrganizationMailUsageMeterId = async () => {
  if (organizationMailUsageMeterId) return organizationMailUsageMeterId;

  const polar = await getPolarClient();
  const organizationId = getPolarApiOrganizationId();
  const meters = await polar.meters.list({
    limit: 100,
    metadata: {
      quieterMeter: ORGANIZATION_MAIL_USAGE_METER_KEY,
    },
    organizationId,
  });
  const existingMeter = meters.result.items.find(
    (meter) => meter.metadata.quieterMeter === ORGANIZATION_MAIL_USAGE_METER_KEY,
  );

  if (existingMeter) {
    organizationMailUsageMeterId = existingMeter.id;
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
          value: ORGANIZATION_MAIL_POLAR_EVENT_NAME,
        },
      ],
      conjunction: "and",
    },
    metadata: {
      quieterMeter: ORGANIZATION_MAIL_USAGE_METER_KEY,
    },
    name: "Quieter Managed Usage overage",
    organizationId,
  });

  organizationMailUsageMeterId = createdMeter.id;
  return createdMeter.id;
};

export const getOrganizationMailMeteredPrice = async () => ({
  amountType: "metered_unit" as const,
  meterId: await getOrganizationMailUsageMeterId(),
  priceCurrency: "usd",
  unitAmount: "1",
});

const recordOrganizationMailUsageAlerts = async (input: {
  organizationId: string;
  period: { end: Date; start: Date };
  settings: OrganizationMailUsageSettings;
  usage: {
    billableCostMicroCents: number;
    sesCostMicroCents: number;
  };
}) => {
  type AlertCandidate = {
    target: OrganizationMailUsageAlertTarget;
    thresholdMicroCents: number;
  };

  const alerts = input.settings.alertMilestonePercents.flatMap((milestonePercent) => {
    const includedUsageThreshold = Math.ceil(
      ORGANIZATION_MAIL_INCLUDED_SES_USAGE_MICROCENTS * (milestonePercent / 100),
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
    .insert(organizationMailUsageAlertEvent)
    .values(alerts)
    .onConflictDoNothing({
      target: [
        organizationMailUsageAlertEvent.organizationId,
        organizationMailUsageAlertEvent.periodStart,
        organizationMailUsageAlertEvent.target,
        organizationMailUsageAlertEvent.milestonePercent,
      ],
    });
};

export const assertCanConsumeOrganizationMailUsage = async (input: {
  estimate: OrganizationMailUsageEstimate;
  organizationId: string;
}) => {
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "organizationMail",
    organizationId: input.organizationId,
  });

  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: "Organization mail API sending requires the managed plan.",
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
    plan: entitlement.plan,
    usedSesCostMicroCents: usage.sesCostMicroCents,
  });

  if (eventOverage.overageSesCostMicroCents > 0 && !entitlement.hasUnlimitedAccess) {
    const settings = await getOrganizationMailUsageSettings(input.organizationId);
    const projectedBillableCostMicroCents =
      usage.billableCostMicroCents + eventOverage.billableCostMicroCents;

    if (!settings.overageEnabled) {
      throw new ORPCError("FORBIDDEN", {
        message: "Managed Usage overage is disabled for this organization.",
        status: 403,
      });
    }

    if (
      settings.monthlyOverageLimitMicroCents != null &&
      projectedBillableCostMicroCents > settings.monthlyOverageLimitMicroCents
    ) {
      throw new ORPCError("FORBIDDEN", {
        message: "Managed Usage overage limit reached for this billing period.",
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
      message: "Managed Usage overage billing is not available for this organization.",
      status: 403,
    });
  }

  if (eventOverage.overageSesCostMicroCents > 0 && !entitlement.hasUnlimitedAccess) {
    await getOrganizationMailUsageMeterId();
  }

  return { entitlement, period };
};

export const recordOrganizationMailUsage = async (input: OrganizationMailUsageInput) => {
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "organizationMail",
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
    plan: entitlement.plan,
    usedSesCostMicroCents: usage.sesCostMicroCents,
  });
  const includedSesCostMicroCents = entitlement.hasUnlimitedAccess
    ? input.sesCostMicroCents
    : Math.min(input.sesCostMicroCents, eventOverage.remainingIncludedSesCostMicroCents);
  const settings = entitlement.hasUnlimitedAccess
    ? DEFAULT_ORGANIZATION_MAIL_USAGE_SETTINGS
    : await getOrganizationMailUsageSettings(input.organizationId);
  const rawBillableCostMicroCents = entitlement.hasUnlimitedAccess
    ? 0
    : eventOverage.billableCostMicroCents;

  if (rawBillableCostMicroCents > 0 && !settings.overageEnabled) {
    throw new ORPCError("FORBIDDEN", {
      message: "Managed Usage overage is disabled for this organization.",
      status: 403,
    });
  }

  if (
    rawBillableCostMicroCents > 0 &&
    settings.monthlyOverageLimitMicroCents != null &&
    usage.billableCostMicroCents + rawBillableCostMicroCents >
      settings.monthlyOverageLimitMicroCents
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "Managed Usage overage limit reached for this billing period.",
      status: 403,
    });
  }

  const billableCostMicroCents = entitlement.hasUnlimitedAccess
    ? 0
    : applyOrganizationMailUsageSettings({
        billableCostMicroCents: rawBillableCostMicroCents,
        currentBillableCostMicroCents: usage.billableCostMicroCents,
        settings,
      });
  const now = new Date();
  const dedupeKey = `${input.direction}:${input.organizationId}:${input.providerMessageId}`;
  const [usageEvent] = await db
    .insert(organizationMailUsageEvent)
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
    .onConflictDoNothing({ target: organizationMailUsageEvent.dedupeKey })
    .returning({
      id: organizationMailUsageEvent.id,
    });

  if (usageEvent && !entitlement.hasUnlimitedAccess) {
    await recordOrganizationMailUsageAlerts({
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

  await getOrganizationMailUsageMeterId();
  await ingestPolarEvents([
    {
      externalCustomerId: `user:${entitlement.billingUserId}`,
      externalId: `organization-mail-usage:${usageEvent.id}`,
      metadata: {
        billableCostCents: billableCostMicroCents / 1_000_000,
        direction: input.direction,
        organizationId: input.organizationId,
        providerMessageId: input.providerMessageId,
        sesCostCents: input.sesCostMicroCents / 1_000_000,
        usageEventId: usageEvent.id,
      },
      name: ORGANIZATION_MAIL_POLAR_EVENT_NAME,
      organizationId: getPolarApiOrganizationId(),
    },
  ]);

  await db
    .update(organizationMailUsageEvent)
    .set({ polarEventReportedAt: new Date() })
    .where(eq(organizationMailUsageEvent.id, usageEvent.id));

  return usageEvent;
};

export const getOrganizationMailUsageOverview = async (organizationId: string) => {
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "organizationMail",
    organizationId,
  });
  const period = getBillingPeriod(entitlement.currentPeriodStart, entitlement.currentPeriodEnd);
  const [settings, usage] = await Promise.all([
    getOrganizationMailUsageSettings(organizationId),
    getPeriodUsageMicroCents({
      end: period.end,
      organizationId,
      start: period.start,
    }),
  ]);

  return {
    hasAccess: entitlement.hasAccess,
    hasUnlimitedAccess: entitlement.hasUnlimitedAccess,
    includedSesUsageMicroCents: ORGANIZATION_MAIL_INCLUDED_SES_USAGE_MICROCENTS,
    managedUsageRates: getManagedUsageRates(entitlement.plan === "pro" ? "pro" : "managed"),
    period,
    remainingIncludedSesUsageMicroCents: entitlement.hasUnlimitedAccess
      ? null
      : Math.max(0, ORGANIZATION_MAIL_INCLUDED_SES_USAGE_MICROCENTS - usage.sesCostMicroCents),
    settings,
    usage,
  };
};

export const recordInboundOrganizationMailUsage = async (input: {
  messageSizeBytes: number;
  providerMessageId: string;
  recipients: string[];
}) => {
  const normalizedRecipients = Array.from(
    new Set(input.recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean)),
  );
  const domains = Array.from(
    new Set(
      normalizedRecipients.flatMap((recipient) => {
        const domain = recipient.split("@").at(1);
        return domain ? [domain] : [];
      }),
    ),
  );

  if (domains.length === 0) return;

  const domainRows = await db
    .select({
      domain: mailDomain.domain,
      organizationId: mailDomain.organizationId,
    })
    .from(mailDomain)
    .where(and(eq(mailDomain.status, "verified"), inArray(mailDomain.domain, domains)));
  const organizationIds = new Set(domainRows.map((row) => row.organizationId));

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

      const estimate = estimateInboundOrganizationMailUsage({
        messageSizeBytes: input.messageSizeBytes,
        recipientCount: orgRecipients.length,
      });

      await recordOrganizationMailUsage({
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
