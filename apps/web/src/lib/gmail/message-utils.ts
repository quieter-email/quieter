import type { MessageListItem } from "./gmail";

const EMAIL_ADDRESS_PATTERN = /([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/i;

const extractSenderEmail = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const match = normalized.match(EMAIL_ADDRESS_PATTERN);
  return match?.[1]?.trim().toLowerCase();
};

export const getParsedMessageDate = (message: MessageListItem) => {
  const source = message.internalDate ?? message.date;
  if (!source) return null;

  const numeric = Number(source);
  const parsed = Number.isFinite(numeric) ? new Date(numeric) : new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatMessageDate = (message: MessageListItem, format: "compact" | "full") => {
  const parsed = getParsedMessageDate(message);
  if (!parsed) return "";

  return new Intl.DateTimeFormat(
    undefined,
    format === "compact"
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "long", timeStyle: "short" },
  ).format(parsed);
};

export const parseSender = (from?: string) => {
  if (!from) return { name: "", email: "", display: "" };

  const display = from.trim();
  const email = extractSenderEmail(display) ?? "";
  const bracketMatch = display.match(/^(.*?)<\s*[^<>@\s]+@[^<>@\s]+\s*>/);
  const rawNameSource = bracketMatch?.[1] ?? (email ? display.replace(email, "") : display);
  const rawName = rawNameSource.replaceAll('"', "").replace(/[<>]/g, "").trim();
  const name = rawName && rawName !== email ? rawName : "";

  return { name, email, display };
};
