import type { AutomationMailMessage } from "@quieter/ai/classify-gmail-message";
import type { VerificationCodeCandidate } from "@quieter/ai/extract-verification-code";

const DEFAULT_VALIDITY_MS = 30 * 60_000;
const MAX_VALIDITY_MS = 2 * 60 * 60_000;
const MAX_MESSAGE_AGE_MS = 2 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export const shouldInspectIncomingVerificationCode = (
  message: AutomationMailMessage,
  now: Date
) => {
  if (
    message.labelIds?.some((label) =>
      ["SENT", "DRAFT", "SPAM", "TRASH"].includes(label.toUpperCase())
    ) === true
  ) {
    return false;
  }
  const internalDate = Number(message.internalDate);
  const receivedAt =
    Number.isFinite(internalDate) && internalDate > 0
      ? internalDate
      : Date.parse(message.date ?? "");
  return (
    Number.isFinite(receivedAt) &&
    receivedAt >= now.getTime() - MAX_MESSAGE_AGE_MS &&
    receivedAt <= now.getTime() + MAX_CLOCK_SKEW_MS
  );
};

export const validateVerificationCodeCandidate = ({
  candidate,
  message,
  now,
}: {
  candidate: VerificationCodeCandidate;
  message: AutomationMailMessage;
  now: Date;
}) => {
  const code = candidate.code?.trim() ?? "";
  if (!/^[\p{L}\p{N}-]{4,12}$/u.test(code)) {
    return null;
  }
  const evidence = [
    message.subject,
    message.snippet,
    message.bodyText,
    message.bodyHtml,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  const escapedCode = code.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (
    !new RegExp(
      `(?<![\\p{L}\\p{N}])${escapedCode}(?![\\p{L}\\p{N}])`,
      "u"
    ).test(evidence)
  ) {
    return null;
  }

  const internalDate = Number(message.internalDate);
  const receivedAt =
    Number.isFinite(internalDate) && internalDate > 0
      ? internalDate
      : Date.parse(message.date ?? "");
  const validityMs = Math.min(
    (candidate.expiresInSeconds ?? DEFAULT_VALIDITY_MS / 1000) * 1000,
    MAX_VALIDITY_MS
  );
  const expiresAt = new Date(
    (Number.isFinite(receivedAt)
      ? Math.min(receivedAt, now.getTime())
      : now.getTime()) + validityMs
  );
  if (expiresAt <= now) {
    return null;
  }

  return {
    code,
    expiresAt,
    service: candidate.service?.trim().slice(0, 80) || null,
  };
};
