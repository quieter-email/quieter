type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
};

type ExtractedMessageContent = {
  html?: string;
  text?: string;
};

type ExtractedMessageAttachment = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
};

type ExtractedInlineMessageAttachment = ExtractedMessageAttachment & {
  contentId: string;
};

const UTF8_CHARSET = "utf-8";

const EDGE_NOISE_REGEX = /^[\s\p{Cf}\u034F]+|[\s\p{Cf}\u034F]+$/gu;
const INLINE_NOISE_REGEX = /\u034F|\u200B|\u200C|\u200D|\u2060|\uFEFF/gu;

const HTML_ENTITY_BY_NAME: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const MOJIBAKE_TOKEN_REGEX =
  /\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]|\u00D0[\u0080-\u00BF]|\u00D1[\u0080-\u00BF]|\u00F0\u0178[\u0080-\u00BF]|\u00EF\u00BF\u00BD|\uFFFD/gu;

const getHeader = (
  part: GmailMessagePart | undefined,
  headerName: string
): string | undefined =>
  part?.headers?.find(
    (header) => header.name.toLowerCase() === headerName.toLowerCase()
  )?.value;

const normalizeMimeType = (mimeType?: string): string =>
  mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";

const toByte = (codePoint = 0): number => codePoint % 256;

const parseCharset = (contentType?: string): string => {
  const match = contentType?.match(
    /charset\s*=\s*["']?(?<charset>[^"';\s]+)["']?/iu
  );
  return match?.groups?.charset ?? UTF8_CHARSET;
};

const decodeBase64ToBytes = (value: string, base64Url: boolean): Uint8Array => {
  const compact = value.replaceAll(/\s+/gu, "");
  const normalized = base64Url
    ? compact.replaceAll("-", "+").replaceAll("_", "/")
    : compact;

  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(padLength)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    const codePoint = binary.codePointAt(index);
    bytes[index] = toByte(codePoint);
  }

  return bytes;
};

const decodeBase64UrlToBytes = (value: string): Uint8Array =>
  decodeBase64ToBytes(value, true);

const decodeQuotedPrintableToBytes = (value: string): Uint8Array => {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("=\n", "");
  const bytes: number[] = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (char === "=") {
      const hex = normalized.slice(index + 1, index + 3);
      if (/^[a-fA-F\d]{2}$/u.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        index += 2;
        continue;
      }
    }

    bytes.push(toByte(normalized.codePointAt(index)));
  }

  return new Uint8Array(bytes);
};

const decodeWithCharset = (
  bytes: Uint8Array,
  charset: string
): string | undefined => {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return undefined;
  }
};

const textToLatin1Bytes = (value: string): Uint8Array => {
  const bytes = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = toByte(value.codePointAt(index));
  }

  return bytes;
};

const getMojibakeScore = (value: string): number =>
  value.match(MOJIBAKE_TOKEN_REGEX)?.length ?? 0;

const repairLikelyUtf8Mojibake = (value: string): string => {
  if (getMojibakeScore(value) === 0) {
    return value;
  }

  const repaired = decodeWithCharset(textToLatin1Bytes(value), UTF8_CHARSET);
  if (repaired === undefined) {
    return value;
  }

  return getMojibakeScore(repaired) < getMojibakeScore(value)
    ? repaired
    : value;
};

const decodeHtmlEntityCodePoint = (
  value: string,
  radix: 10 | 16
): string | undefined => {
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10_ff_ff) {
    return undefined;
  }

  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return undefined;
  }
};

const decodeHtmlEntities = (value: string): string => {
  let decoded = value;

  for (let pass = 0; pass < 2; pass += 1) {
    const next = decoded.replaceAll(
      /&(?:#(?<decimal>\d+)|#x(?<hex>[\da-fA-F]+)|(?<named>[a-zA-Z][a-zA-Z\d]+));/gu,
      (
        entity,
        decimalValue: string | undefined,
        hexValue: string | undefined,
        namedValue: string | undefined
      ) => {
        if (decimalValue !== undefined) {
          return decodeHtmlEntityCodePoint(decimalValue, 10) ?? entity;
        }

        if (hexValue !== undefined) {
          return decodeHtmlEntityCodePoint(hexValue, 16) ?? entity;
        }

        if (namedValue !== undefined) {
          return HTML_ENTITY_BY_NAME[namedValue.toLowerCase()] ?? entity;
        }

        return entity;
      }
    );

    if (next === decoded) {
      break;
    }
    decoded = next;
  }

  return decoded;
};

const CID_REFERENCE_REGEX = /cid:(?<contentId>[^"' >]+)/giu;

const stripInlineNoise = (value: string): string =>
  value.replace(INLINE_NOISE_REGEX, "");

const trimBoundaryNoise = (value: string): string =>
  value.replace(EDGE_NOISE_REGEX, "");

const normalizeDecodedValue = (value: string): string =>
  trimBoundaryNoise(stripInlineNoise(decodeHtmlEntities(value)));

const decodeBytesAsText = (bytes: Uint8Array, charset: string): string => {
  const normalizedCharset = charset.trim().toLowerCase();
  const resolvedCharset =
    normalizedCharset.length > 0 ? normalizedCharset : UTF8_CHARSET;
  const decodedWithCharset = decodeWithCharset(bytes, resolvedCharset);
  const decodedUtf8 =
    resolvedCharset === UTF8_CHARSET
      ? decodedWithCharset
      : decodeWithCharset(bytes, UTF8_CHARSET);

  if (decodedWithCharset === undefined) {
    return decodedUtf8 ?? new TextDecoder().decode(bytes);
  }

  if (decodedUtf8 !== undefined) {
    const scoreWithCharset = getMojibakeScore(decodedWithCharset);
    const scoreUtf8 = getMojibakeScore(decodedUtf8);

    if (scoreUtf8 < scoreWithCharset) {
      return decodedUtf8;
    }
  }

  return repairLikelyUtf8Mojibake(decodedWithCharset);
};

const decodeMimeEncodedWord = (
  charset: string,
  encoding: string,
  encodedText: string
): string => {
  const bytes =
    encoding.toLowerCase() === "b"
      ? decodeBase64ToBytes(encodedText, false)
      : decodeQuotedPrintableToBytes(encodedText.replaceAll("_", " "));

  return decodeBytesAsText(
    bytes,
    charset.replaceAll(/["']/gu, "").trim() || UTF8_CHARSET
  );
};

export const decodeMimeHeaderValue = (value?: string): string | undefined => {
  if (value === undefined || value.length === 0) {
    return value;
  }

  let output = "";
  let cursor = 0;
  let matchedEncodedWord = false;
  let previousWordWasDecoded = false;

  for (const match of value.matchAll(
    /[=]\?(?<charset>[^?]+)\?(?<encoding>[bBqQ])\?(?<encodedText>[^?]*)\?=/gu
  )) {
    const index = match.index ?? 0;
    const between = value.slice(cursor, index);

    if (!(previousWordWasDecoded && /^\s+$/u.test(between))) {
      output += between;
    }

    const [fullMatch] = match;
    const charset = match.groups?.charset;
    const encoding = match.groups?.encoding;
    const encodedText = match.groups?.encodedText;

    if (
      charset === undefined ||
      encoding === undefined ||
      encodedText === undefined
    ) {
      output += fullMatch;
      previousWordWasDecoded = false;
      cursor = index + fullMatch.length;
      continue;
    }

    try {
      output += decodeMimeEncodedWord(charset, encoding, encodedText);
      previousWordWasDecoded = true;
      matchedEncodedWord = true;
    } catch {
      output += fullMatch;
      previousWordWasDecoded = false;
    }

    cursor = index + fullMatch.length;
  }

  output += value.slice(cursor);

  const decodedValue = repairLikelyUtf8Mojibake(
    matchedEncodedWord ? output : value
  );
  const normalizedValue = normalizeDecodedValue(decodedValue);

  return normalizedValue.length > 0 ? normalizedValue : undefined;
};

const getContentDisposition = (part: GmailMessagePart): string | undefined =>
  getHeader(part, "Content-Disposition")?.toLowerCase();

const isAttachmentPart = (part: GmailMessagePart): boolean => {
  const fileName = part.filename?.trim();
  if (fileName !== undefined && fileName.length > 0) {
    return true;
  }

  const contentDisposition = getContentDisposition(part);
  return contentDisposition?.startsWith("attachment") === true;
};

const collectParts = (
  part: GmailMessagePart | undefined
): GmailMessagePart[] => {
  if (part === undefined) {
    return [];
  }
  const nested = (part.parts ?? []).flatMap((child) => collectParts(child));
  return [part, ...nested];
};

const getAttachmentFileName = (
  part: GmailMessagePart,
  index: number
): string => {
  const decoded = decodeMimeHeaderValue(part.filename?.trim())?.trim();
  if (decoded !== undefined && decoded.length > 0) {
    return decoded;
  }
  return `attachment-${index + 1}`;
};

export const findRenderablePart = (
  payload: GmailMessagePart | undefined,
  mimeType: "text/html" | "text/plain",
  options?: { requireInlineData?: boolean }
): GmailMessagePart | undefined =>
  collectParts(payload).find(
    (part) =>
      normalizeMimeType(part.mimeType) === mimeType &&
      !isAttachmentPart(part) &&
      (options?.requireInlineData === true
        ? (part.body?.data ?? "") !== ""
        : (part.body?.data ?? "") !== "" ||
          (part.body?.attachmentId ?? "") !== "")
  );

const findRenderableInlinePart = (
  payload: GmailMessagePart | undefined,
  mimeType: "text/html" | "text/plain"
) => findRenderablePart(payload, mimeType, { requireInlineData: true });

export const decodePartBody = (part: GmailMessagePart): string | undefined => {
  const data = part.body?.data;
  if (data === undefined || data.length === 0) {
    return undefined;
  }

  const baseBytes = decodeBase64UrlToBytes(data);
  const contentType = getHeader(part, "Content-Type");
  const charset = parseCharset(contentType);
  const decoded = decodeBytesAsText(baseBytes, charset).trim();
  return decoded.length > 0 ? decoded : undefined;
};

const normalizeContentId = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  const normalized = trimmed.replaceAll(/^<|>$/gu, "").toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
};

const extractReferencedInlineContentIds = (
  payload: GmailMessagePart | undefined
): ReadonlySet<string> => {
  const htmlPart = findRenderableInlinePart(payload, "text/html");
  const html = htmlPart ? decodePartBody(htmlPart) : undefined;
  if (html === undefined || html.length === 0) {
    return new Set();
  }

  const contentIds = new Set<string>();
  for (const match of html.matchAll(CID_REFERENCE_REGEX)) {
    const contentId = normalizeContentId(match.groups?.contentId);
    if (contentId !== undefined) {
      contentIds.add(contentId);
    }
  }

  return contentIds;
};

export const extractMessageContent = (
  payload: GmailMessagePart | undefined
): ExtractedMessageContent => {
  const htmlPart = findRenderableInlinePart(payload, "text/html");
  const textPart = findRenderableInlinePart(payload, "text/plain");

  return {
    html: htmlPart ? decodePartBody(htmlPart) : undefined,
    text: textPart ? decodePartBody(textPart) : undefined,
  };
};

export const extractMessageAttachments = (
  payload: GmailMessagePart | undefined
): ExtractedMessageAttachment[] => {
  const attachments: ExtractedMessageAttachment[] = [];
  const seenAttachments = new Set<string>();
  const referencedInlineContentIds = extractReferencedInlineContentIds(payload);

  for (const [index, part] of collectParts(payload).entries()) {
    const attachmentId = part.body?.attachmentId?.trim();
    if (attachmentId === undefined || attachmentId.length === 0) {
      continue;
    }

    const mimeType = normalizeMimeType(part.mimeType);
    if (
      !isAttachmentPart(part) &&
      (mimeType === "text/html" || mimeType === "text/plain")
    ) {
      continue;
    }

    const contentId = normalizeContentId(getHeader(part, "Content-ID"));
    const contentDisposition = getContentDisposition(part);
    if (
      contentId !== undefined &&
      (referencedInlineContentIds.has(contentId) ||
        contentDisposition?.startsWith("inline") === true)
    ) {
      continue;
    }

    const fileName = getAttachmentFileName(part, index);
    const dedupeKey = `${attachmentId}:${fileName}`;
    if (seenAttachments.has(dedupeKey)) {
      continue;
    }
    seenAttachments.add(dedupeKey);

    attachments.push({
      attachmentId,
      fileName,
      mimeType: normalizeMimeType(part.mimeType) || "application/octet-stream",
      size: part.body?.size ?? 0,
    });
  }

  return attachments;
};

export const extractInlineMessageAttachments = (
  payload: GmailMessagePart | undefined
): ExtractedInlineMessageAttachment[] => {
  const attachments: ExtractedInlineMessageAttachment[] = [];
  const seenAttachments = new Set<string>();
  const referencedInlineContentIds = extractReferencedInlineContentIds(payload);

  for (const [index, part] of collectParts(payload).entries()) {
    const attachmentId = part.body?.attachmentId?.trim();
    if (attachmentId === undefined || attachmentId.length === 0) {
      continue;
    }

    const contentId = normalizeContentId(getHeader(part, "Content-ID"));
    if (contentId === undefined || !referencedInlineContentIds.has(contentId)) {
      continue;
    }

    const fileName = getAttachmentFileName(part, index);
    const dedupeKey = `${attachmentId}:${fileName}:${contentId}`;
    if (seenAttachments.has(dedupeKey)) {
      continue;
    }
    seenAttachments.add(dedupeKey);

    attachments.push({
      attachmentId,
      contentId,
      fileName,
      mimeType: normalizeMimeType(part.mimeType) || "application/octet-stream",
      size: part.body?.size ?? 0,
    });
  }

  return attachments;
};
