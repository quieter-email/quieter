export const ORGANIZATION_MAIL_COST_RECOVERY_BASIS_POINTS = 10_000;

export const SES_OUTBOUND_MESSAGE_MICROCENTS = 10_000;
export const SES_OUTBOUND_ATTACHMENT_DATA_MICROCENTS_PER_GB = 12_000_000;
export const SES_INBOUND_MESSAGE_MICROCENTS = 10_000;
export const SES_INBOUND_CHUNK_MICROCENTS = 9_000;
export const SES_INBOUND_CHUNK_BYTES = 256 * 1024;

export const applyManagedUsageMarkup = (input: { sesCostUsdMicroCents: number }) => {
  if (!Number.isFinite(input.sesCostUsdMicroCents) || input.sesCostUsdMicroCents < 0) {
    throw new Error("SES cost must be a finite non-negative number.");
  }

  return Math.ceil(
    input.sesCostUsdMicroCents * (1 + ORGANIZATION_MAIL_COST_RECOVERY_BASIS_POINTS / 10_000),
  );
};

const microCentsToCurrency = (microCents: number) => microCents / 100_000_000;

export const getManagedUsageRates = () => ({
  attachmentDataPerGbUsd: microCentsToCurrency(
    applyManagedUsageMarkup({
      sesCostUsdMicroCents: SES_OUTBOUND_ATTACHMENT_DATA_MICROCENTS_PER_GB,
    }),
  ),
  inboundProcessingPerThousandUsd: microCentsToCurrency(
    applyManagedUsageMarkup({
      sesCostUsdMicroCents: SES_INBOUND_CHUNK_MICROCENTS * 1_000,
    }),
  ),
  messagesPerThousandUsd: microCentsToCurrency(
    applyManagedUsageMarkup({
      sesCostUsdMicroCents: SES_OUTBOUND_MESSAGE_MICROCENTS * 1_000,
    }),
  ),
});
