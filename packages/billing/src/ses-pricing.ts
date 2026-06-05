export const TEAM_MAIL_INCLUDED_SES_USAGE_MICROCENTS = 1_000_000_000;
export const TEAM_MAIL_OVERAGE_MARKUP_BASIS_POINTS = 500;

export const SES_OUTBOUND_MESSAGE_MICROCENTS = 10_000;
export const SES_OUTBOUND_ATTACHMENT_DATA_MICROCENTS_PER_GB = 12_000_000;
export const SES_INBOUND_MESSAGE_MICROCENTS = 10_000;
export const SES_INBOUND_CHUNK_MICROCENTS = 9_000;
export const SES_INBOUND_CHUNK_BYTES = 256 * 1024;

export const formatSesUsagePriceFeature = () =>
  "$10 SES usage included; overages at SES + 5% ($0.105/1K outbound or inbound emails, $0.126/GB outbound attachment data, $0.0945/1K inbound chunks)";
