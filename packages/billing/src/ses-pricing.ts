export const ORGANIZATION_MAIL_INCLUDED_SES_USAGE_MICROCENTS = 1_000_000_000;
export const ORGANIZATION_MAIL_OVERAGE_MARKUP_BASIS_POINTS = {
  managed: 10_000,
  pro: 5_000,
} as const;

export const SES_OUTBOUND_MESSAGE_MICROCENTS = 10_000;
export const SES_OUTBOUND_ATTACHMENT_DATA_MICROCENTS_PER_GB = 12_000_000;
export const SES_INBOUND_MESSAGE_MICROCENTS = 10_000;
export const SES_INBOUND_CHUNK_MICROCENTS = 9_000;
export const SES_INBOUND_CHUNK_BYTES = 256 * 1024;

type ManagedUsagePlan = keyof typeof ORGANIZATION_MAIL_OVERAGE_MARKUP_BASIS_POINTS;

export const getManagedUsageMarkupBasisPoints = (plan: ManagedUsagePlan | null) =>
  ORGANIZATION_MAIL_OVERAGE_MARKUP_BASIS_POINTS[plan === "pro" ? "pro" : "managed"];

const applyManagedUsageMarkup = (microCents: number, plan: ManagedUsagePlan) =>
  Math.ceil(microCents * (1 + getManagedUsageMarkupBasisPoints(plan) / 10_000));

const microCentsToDollars = (microCents: number) => microCents / 100_000_000;

export const getManagedUsageRates = (plan: ManagedUsagePlan) => ({
  attachmentDataPerGbDollars: microCentsToDollars(
    applyManagedUsageMarkup(SES_OUTBOUND_ATTACHMENT_DATA_MICROCENTS_PER_GB, plan),
  ),
  inboundProcessingPerThousandDollars: microCentsToDollars(
    applyManagedUsageMarkup(SES_INBOUND_CHUNK_MICROCENTS * 1_000, plan),
  ),
  markupPercent: getManagedUsageMarkupBasisPoints(plan) / 100,
  messagesPerThousandDollars: microCentsToDollars(
    applyManagedUsageMarkup(SES_OUTBOUND_MESSAGE_MICROCENTS * 1_000, plan),
  ),
});

const formatRate = (value: number) =>
  new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 4,
    minimumFractionDigits: 3,
    style: "currency",
  }).format(value);
export const formatManagedUsagePriceFeature = (plan: ManagedUsagePlan) => {
  const rates = getManagedUsageRates(plan);

  return `Managed mail costs ${formatRate(
    rates.messagesPerThousandDollars,
  )}/1K outbound mails, ${formatRate(rates.attachmentDataPerGbDollars)}/GB attachments, ${formatRate(
    rates.inboundProcessingPerThousandDollars,
  )}/1K inbound mails`;
};
