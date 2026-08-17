import type { AutomationMailMessage } from "@quieter/ai/classify-gmail-message";

import { hasText } from "../text";

/**
 * Generous on purpose. A code printed below a long newsletter body is still a
 * code the reader is waiting for, and scanning the whole message costs
 * microseconds. Only pathological messages are cut, and the raw cap keeps
 * markup-heavy mail from turning into unbounded work.
 */
const MAX_TEXT_LENGTH = 60_000;
const MAX_RAW_LENGTH = 400_000;

/**
 * Style, script and preview-header sections carry text that never reaches the
 * reader. Dropping them before tag stripping keeps CSS values and tracking
 * payloads out of the extracted text.
 */
const HTML_HIDDEN_SECTION_OPEN_PATTERN =
  /<(?<tag>head|noscript|script|style|template|title)\b[^<>]*>/giu;
/**
 * The tag body excludes `<` as well as `>`, so an unclosed `<` gives up at the
 * next one instead of scanning the rest of the message and backtracking over it.
 * A run of them is common in broken mail and would otherwise cost the square of
 * its length. Real markup escapes `<` inside a tag, so nothing legible is lost.
 */
const HTML_BLOCK_TAG_PATTERN =
  /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^<>]*>/giu;
const HTML_TAG_PATTERN = /<[^<>]*>/gu;
/**
 * Soft hyphens and zero-width joiners are routinely injected between digits to
 * defeat scrapers, so they are removed before any code is read.
 */
const INVISIBLE_CHARACTER_CODE_POINTS = [
  0x00_ad, 0x20_0b, 0x20_0c, 0x20_0d, 0x20_0e, 0x20_0f, 0x20_60, 0xfe_ff,
];
const INVISIBLE_CHARACTER_PATTERN = new RegExp(
  `[${INVISIBLE_CHARACTER_CODE_POINTS.map((codePoint) =>
    String.fromCodePoint(codePoint)
  ).join("")}]`,
  "gu"
);
const ENTITY_PATTERN =
  /&(?:#(?<decimal>\d{1,7})|#[Xx](?<hexadecimal>[\dA-Fa-f]{1,6})|(?<name>[A-Za-z][\dA-Za-z]{1,9}));/gu;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: " ",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "-",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsquo: "’",
  shy: "",
  zwj: "",
  zwnj: "",
};

const decodeCodePoint = (codePoint: number) => {
  if (
    !Number.isInteger(codePoint) ||
    codePoint < 32 ||
    codePoint > 0x10_ff_ff ||
    (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
  ) {
    return " ";
  }
  return String.fromCodePoint(codePoint);
};

const resolveEntity = (match: RegExpMatchArray) => {
  const { decimal, hexadecimal, name } = match.groups ?? {};
  if (hasText(decimal)) {
    return decodeCodePoint(Math.trunc(Number(decimal)));
  }
  if (hasText(hexadecimal)) {
    return decodeCodePoint(Number.parseInt(hexadecimal, 16));
  }
  return NAMED_ENTITIES[(name ?? "").toLowerCase()] ?? match[0];
};

const decodeHtmlEntities = (value: string) => {
  if (!value.includes("&")) {
    return value;
  }

  let decoded = "";
  let lastIndex = 0;
  for (const match of value.matchAll(ENTITY_PATTERN)) {
    const index = match.index ?? 0;
    decoded += value.slice(lastIndex, index) + resolveEntity(match);
    lastIndex = index + match[0].length;
  }

  return decoded + value.slice(lastIndex);
};

/**
 * Keeps line structure, because a code rendered on its own line is a much
 * stronger signal than the same digits inside a sentence.
 */
const normalizeWhitespace = (value: string) =>
  value
    .replaceAll(/\r\n?/gu, "\n")
    .replaceAll(INVISIBLE_CHARACTER_PATTERN, "")
    .replaceAll(/[^\S\n]+/gu, " ")
    .replaceAll(/ ?\n ?/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();

/**
 * A lazy `[\s\S]*?` span rescans to the end of the input at every opener, so a
 * body of repeated `<!--` with no closer costs the square of its length. Mail
 * markup is attacker-controlled, so removal is scanned by index instead: every
 * character is visited once, and an opener with no closer is simply left as
 * text for the tag stripper.
 */
const removeHtmlComments = (html: string) => {
  let result = "";
  let index = 0;

  for (;;) {
    const start = html.indexOf("<!--", index);
    if (start === -1) {
      break;
    }

    const end = html.indexOf("-->", start + 4);
    // No closer after this opener means none after any later one either.
    if (end === -1) {
      break;
    }

    result += `${html.slice(index, start)} `;
    index = end + 3;
  }

  return result + html.slice(index);
};

const removeHiddenSections = (html: string) => {
  // A private copy, because `lastIndex` is driven directly below.
  const openPattern = new RegExp(
    HTML_HIDDEN_SECTION_OPEN_PATTERN.source,
    "giu"
  );
  // A tag whose closer is missing from here on is missing for every later
  // opener too, so it is only searched for once.
  const unclosedTags = new Set<string>();
  let result = "";
  let index = 0;

  for (
    let open = openPattern.exec(html);
    open !== null;
    open = openPattern.exec(html)
  ) {
    const tag = (open.groups?.tag ?? "").toLowerCase();
    if (unclosedTags.has(tag)) {
      continue;
    }

    const closePattern = new RegExp(`</${tag}\\s*>`, "giu");
    closePattern.lastIndex = openPattern.lastIndex;
    const close = closePattern.exec(html);
    if (close === null) {
      unclosedTags.add(tag);
      continue;
    }

    result += `${html.slice(index, open.index)} `;
    index = closePattern.lastIndex;
    openPattern.lastIndex = index;
  }

  return result + html.slice(index);
};

export const htmlToPlainText = (html: string) =>
  normalizeWhitespace(
    decodeHtmlEntities(
      removeHiddenSections(removeHtmlComments(html.slice(0, MAX_RAW_LENGTH)))
        .replaceAll(HTML_BLOCK_TAG_PATTERN, "\n")
        .replaceAll(HTML_TAG_PATTERN, " ")
    )
  );

export type MailPlainText = {
  body: string;
  subject: string;
};

export const getMailPlainText = (
  message: AutomationMailMessage
): MailPlainText => {
  let body = "";
  if (hasText(message.bodyText)) {
    body = normalizeWhitespace(message.bodyText.slice(0, MAX_RAW_LENGTH));
  } else if (hasText(message.bodyHtml)) {
    body = htmlToPlainText(message.bodyHtml);
  } else if (hasText(message.snippet)) {
    body = normalizeWhitespace(message.snippet);
  }

  return {
    body: body.slice(0, MAX_TEXT_LENGTH),
    subject: hasText(message.subject)
      ? normalizeWhitespace(message.subject).slice(0, 500)
      : "",
  };
};
