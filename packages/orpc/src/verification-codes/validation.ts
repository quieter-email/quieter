import type { AutomationMailMessage } from "@quieter/ai/classify-gmail-message";
import type { VerificationCodeCandidate } from "@quieter/ai/extract-verification-code";
import { compile } from "html-to-text";

const DEFAULT_VALIDITY_MS = 30 * 60_000;
const MAX_VALIDITY_MS = 2 * 60 * 60_000;
const MAX_MESSAGE_AGE_MS = 2 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const htmlToVisibleText = compile({
  selectors: [
    { format: "inline", selector: "a" },
    { format: "skip", selector: "img" },
    { format: "skip", selector: "script" },
    { format: "skip", selector: "style" },
    { format: "skip", selector: "[hidden]" },
    { format: "skip", selector: "[aria-hidden=true]" },
    { format: "skip", selector: '[style*="display:none"i]' },
    { format: "skip", selector: '[style*="display: none"i]' },
  ],
  wordwrap: false,
});

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
  const extractedCode = candidate.code?.trim() ?? "";
  if (!/^[\p{L}\p{N}\p{Z}\s-]+$/u.test(extractedCode)) {
    return null;
  }
  const code = extractedCode.replaceAll(/[\p{Z}\s]/gu, "");
  if (!/^[\p{L}\p{N}-]{4,12}$/u.test(code)) {
    return null;
  }
  const evidence = [
    message.subject,
    message.snippet,
    message.bodyText,
    message.bodyHtml ? htmlToVisibleText(message.bodyHtml) : undefined,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  // Codes contain only letters, numbers, and hyphens after validation.
  // oxlint-disable-next-line typescript/no-misused-spread
  const escapedCode = [...code]
    .map((character) => character.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("[\\p{Z}\\t]*");
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
  return {
    code,
    expiresAt,
    service: candidate.service?.trim().slice(0, 80) || null,
  };
};
