import type { MessageListItem } from "./gmail";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

const EMAIL_ADDRESS_PATTERN =
  /(?<email>[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/iu;
const compactMessageDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const fullMessageDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "long",
  timeStyle: "short",
});
const messageListTimeFormatter = new Intl.DateTimeFormat(undefined, {
  timeStyle: "short",
});
const messageListCurrentYearDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const messageListPreviousYearDateFormatter = new Intl.DateTimeFormat(
  undefined,
  {
    day: "numeric",
    month: "short",
    year: "numeric",
  }
);

const extractSenderEmail = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  if (!hasText(normalized)) {
    return undefined;
  }

  const match = EMAIL_ADDRESS_PATTERN.exec(normalized);
  return match?.groups?.email?.trim().toLowerCase();
};

const getParsedMessageDate = (message: MessageListItem) => {
  const source = message.internalDate ?? message.date;
  if (!hasText(source)) {
    return null;
  }

  const numeric = Number(source);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatMessageDate = (
  message: MessageListItem,
  format: "compact" | "full"
) => {
  const parsed = getParsedMessageDate(message);
  if (parsed === null) {
    return "";
  }

  return (
    format === "compact"
      ? compactMessageDateFormatter
      : fullMessageDateFormatter
  ).format(parsed);
};

export const formatMessageListDate = (
  message: MessageListItem,
  referenceDate = new Date()
) => {
  const parsed = getParsedMessageDate(message);
  if (!parsed) {
    return "";
  }

  const isCurrentYear = parsed.getFullYear() === referenceDate.getFullYear();
  const isToday =
    isCurrentYear &&
    parsed.getMonth() === referenceDate.getMonth() &&
    parsed.getDate() === referenceDate.getDate();

  if (isToday) {
    return messageListTimeFormatter.format(parsed);
  }

  return (
    isCurrentYear
      ? messageListCurrentYearDateFormatter
      : messageListPreviousYearDateFormatter
  ).format(parsed);
};

export const parseSender = (from?: string) => {
  if (!hasText(from)) {
    return { display: "", email: "", name: "" };
  }

  const display = from.trim();
  const email = extractSenderEmail(display) ?? "";
  const bracketMatch = /^(?<name>.*?)<\s*[^<>@\s]+@[^<>@\s]+\s*>/u.exec(
    display
  );
  const rawNameSource =
    bracketMatch?.groups?.name ??
    (hasText(email) ? display.replace(email, "") : display);
  const rawName = rawNameSource
    .replaceAll('"', "")
    .replaceAll(/[<>]/gu, "")
    .trim();
  const name = hasText(rawName) && rawName !== email ? rawName : "";

  return { display, email, name };
};
