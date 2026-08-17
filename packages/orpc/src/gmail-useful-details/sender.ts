import { hasText } from "../text";

const MAX_NAME_LENGTH = 80;
const MAX_DOMAIN_LENGTH = 253;

/**
 * Display names that identify the mailbox robot rather than the service, so a
 * card headline falls back to the sending domain instead.
 */
const GENERIC_SENDER_NAMES = new Set([
  "account",
  "accounts",
  "admin",
  "alert",
  "alerts",
  "auto",
  "automated",
  "billing",
  "bot",
  "contact",
  "customer care",
  "customer service",
  "do not reply",
  "donotreply",
  "hello",
  "help",
  "info",
  "kundenservice",
  "mail",
  "mail delivery",
  "mailer",
  "mailer daemon",
  "news",
  "newsletter",
  "no reply",
  "noreply",
  "notification",
  "notifications",
  "postmaster",
  "security",
  "service",
  "support",
  "system",
  "team",
  "webmaster",
]);

/**
 * Trailing words that add nothing to a headline. "Hetzner Online Team" reads
 * better as "Hetzner Online".
 */
const TRAILING_NAME_WORDS = new Set([
  "ag",
  "alerts",
  "accounts",
  "billing",
  "bv",
  "co",
  "corp",
  "gmbh",
  "inc",
  "kg",
  "kgaa",
  "llc",
  "ltd",
  "mbh",
  "notifications",
  "nv",
  "oy",
  "plc",
  "sa",
  "sarl",
  "se",
  "security",
  "service",
  "srl",
  "support",
  "team",
  "ug",
]);

const MULTI_LEVEL_SUFFIXES = new Set([
  "ac.uk",
  "co.at",
  "co.il",
  "co.in",
  "co.jp",
  "co.kr",
  "co.nz",
  "co.uk",
  "co.za",
  "com.au",
  "com.br",
  "com.mx",
  "com.sg",
  "com.tr",
  "gov.uk",
  "net.au",
  "org.uk",
]);

const ADDRESS_PATTERN =
  /[\dA-Za-z._%+-]+@(?<domain>[\d.A-Za-z-]+\.[A-Za-z]{2,})/u;
const MAILBOX_PATTERN = /^\s*(?<name>[^<>]*?)\s*<(?<address>[^<>]+)>\s*$/u;

export const getSenderSource = (from?: string | null) => {
  const domain = from?.match(ADDRESS_PATTERN)?.groups?.domain;
  return hasText(domain)
    ? domain.toLowerCase().slice(0, MAX_DOMAIN_LENGTH)
    : null;
};

const parseSender = (from: string) => {
  const mailbox = MAILBOX_PATTERN.exec(from);
  if (mailbox?.groups) {
    return {
      address: mailbox.groups.address ?? "",
      displayName: mailbox.groups.name ?? "",
    };
  }
  return { address: from, displayName: from.includes("@") ? "" : from };
};

const cleanDisplayName = (value: string) => {
  const name = value
    .replaceAll(/^["'\s]+|["'\s]+$/gu, "")
    .replaceAll(/\s+/gu, " ");
  if (!hasText(name) || name.includes("@")) {
    return null;
  }

  const words = name.split(" ");
  while (
    words.length > 1 &&
    TRAILING_NAME_WORDS.has(
      (words.at(-1) ?? "").toLowerCase().replaceAll(/[^\da-z]/gu, "")
    )
  ) {
    words.pop();
  }

  const trimmed = words.join(" ").replaceAll(/[,\s]+$/gu, "");
  if (
    !hasText(trimmed) ||
    GENERIC_SENDER_NAMES.has(trimmed.toLowerCase()) ||
    !/\p{L}/u.test(trimmed)
  ) {
    return null;
  }

  return trimmed.slice(0, MAX_NAME_LENGTH);
};

const capitalize = (value: string) =>
  value
    .split("-")
    .map((part) =>
      hasText(part) ? part[0]?.toUpperCase() + part.slice(1) : part
    )
    .join("-");

const getRegistrableLabel = (domain: string) => {
  const labels = domain.split(".");
  if (labels.length < 2) {
    return null;
  }

  const suffixLabels = MULTI_LEVEL_SUFFIXES.has(labels.slice(-2).join("."))
    ? 2
    : 1;
  return labels.at(-1 - suffixLabels) ?? null;
};

const getDomainName = (address: string) => {
  const domain = getSenderSource(address);
  if (domain === null) {
    return null;
  }

  const label = getRegistrableLabel(domain);
  if (label === null || label.length < 3 || !/[^\d]/u.test(label)) {
    return null;
  }

  return capitalize(label);
};

/**
 * A recognizable service name for a card headline. Prefers the sender's display
 * name and falls back to the registrable part of the sending domain, so
 * "noreply@hetzner.com" reads as "Hetzner" instead of a robot address.
 */
export const getSenderServiceName = (from?: string | null) => {
  if (!hasText(from)) {
    return null;
  }

  const { address, displayName } = parseSender(from);
  return cleanDisplayName(displayName) ?? getDomainName(address);
};
