import { XMLParser, XMLValidator } from "fast-xml-parser";

const BIMI_VERSION = "BIMI1";
const DNS_TXT_RECORD_TYPE = 16;
const DNS_TIMEOUT_MS = 3000;
const DNS_NEGATIVE_CACHE_MS = 5 * 60 * 1000;
const MIN_CACHE_MS = 60 * 1000;
const MAX_CACHE_MS = 60 * 60 * 1000;
const DEFAULT_ASSET_CACHE_MS = 15 * 60 * 1000;
const MAX_SVG_BYTES = 32 * 1024;
const MAX_SVG_DIMENSION = 4096;
const MAX_SVG_ATTRIBUTE_LENGTH = 2048;
const MAX_DOMAIN_CANDIDATES = 8;
const DNS_OVER_HTTPS_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
const IP_ADDRESS_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:.]+\]$/iu;
const SAFE_LENGTH_PATTERN =
  /^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?(?:px|pt|pc|mm|cm|in|em|ex|%)?$/iu;
const SAFE_ID_PATTERN = /^[a-z_][a-z0-9_.:-]{0,127}$/iu;
const SAFE_URL_REFERENCE_PATTERN = /^url\(\s*#[a-z_][a-z0-9_.:-]*\s*\)$/iu;

const COMMON_ATTRIBUTES = [
  "alignment-baseline",
  "aria-label",
  "color",
  "color-interpolation",
  "display",
  "fill",
  "fill-opacity",
  "fill-rule",
  "font-family",
  "font-size",
  "font-style",
  "font-variant",
  "font-weight",
  "letter-spacing",
  "opacity",
  "role",
  "shape-rendering",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "text-anchor",
  "text-decoration",
  "text-rendering",
  "transform",
  "vector-effect",
  "visibility",
  "xml:lang",
  "xml:space",
] as const;

const ELEMENT_ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [
    "svg",
    new Set([
      ...COMMON_ATTRIBUTES,
      "baseProfile",
      "height",
      "preserveAspectRatio",
      "version",
      "viewBox",
      "width",
      "xmlns",
      "zoomAndPan",
      "externalResourcesRequired",
    ]),
  ],
  ["g", new Set([...COMMON_ATTRIBUTES, "id"])],
  ["defs", new Set(COMMON_ATTRIBUTES)],
  ["path", new Set([...COMMON_ATTRIBUTES, "d", "id", "pathLength"])],
  [
    "rect",
    new Set([
      ...COMMON_ATTRIBUTES,
      "height",
      "id",
      "rx",
      "ry",
      "width",
      "x",
      "y",
    ]),
  ],
  ["circle", new Set([...COMMON_ATTRIBUTES, "cx", "cy", "id", "r"])],
  ["ellipse", new Set([...COMMON_ATTRIBUTES, "cx", "cy", "id", "rx", "ry"])],
  ["line", new Set([...COMMON_ATTRIBUTES, "id", "x1", "x2", "y1", "y2"])],
  ["polyline", new Set([...COMMON_ATTRIBUTES, "id", "points"])],
  ["polygon", new Set([...COMMON_ATTRIBUTES, "id", "points"])],
  [
    "linearGradient",
    new Set([
      ...COMMON_ATTRIBUTES,
      "gradientTransform",
      "gradientUnits",
      "id",
      "spreadMethod",
      "x1",
      "x2",
      "y1",
      "y2",
    ]),
  ],
  [
    "radialGradient",
    new Set([
      ...COMMON_ATTRIBUTES,
      "cx",
      "cy",
      "fx",
      "fy",
      "gradientTransform",
      "gradientUnits",
      "id",
      "r",
      "spreadMethod",
    ]),
  ],
  ["stop", new Set([...COMMON_ATTRIBUTES, "id", "offset"])],
  [
    "text",
    new Set([
      ...COMMON_ATTRIBUTES,
      "dx",
      "dy",
      "id",
      "lengthAdjust",
      "textLength",
      "x",
      "y",
    ]),
  ],
  [
    "tspan",
    new Set([
      ...COMMON_ATTRIBUTES,
      "dx",
      "dy",
      "id",
      "lengthAdjust",
      "textLength",
      "x",
      "y",
    ]),
  ],
  ["title", new Set(["id", "xml:lang"])],
  ["desc", new Set(["id", "xml:lang"])],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const getNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const clampCacheDuration = (durationMs: number): number =>
  Math.min(Math.max(durationMs, MIN_CACHE_MS), MAX_CACHE_MS);

const normalizeDomain = (value: string): string | undefined => {
  const normalized = value.trim().toLowerCase().replace(/\.$/u, "");
  return DOMAIN_PATTERN.test(normalized) ? normalized : undefined;
};

const getDomainCandidates = (domain: string): string[] => {
  const labels = domain.split(".");
  const candidates: string[] = [];
  for (
    let start = 0;
    start < labels.length - 1 && candidates.length < MAX_DOMAIN_CANDIDATES;
    start += 1
  ) {
    candidates.push(labels.slice(start).join("."));
  }
  return candidates;
};

const decodeDnsTxtData = (value: string): string | undefined => {
  const source = value.trim();
  if (source === "") {
    return undefined;
  }

  let decoded = "";
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/u.test(character ?? "")) {
      continue;
    }
    if (character === "\\") {
      const octal = source.slice(index + 1, index + 4);
      if (/^\d{3}$/u.test(octal) && Number(octal) <= 255) {
        decoded += String.fromCodePoint(Number(octal));
        index += 3;
        continue;
      }
      const escaped = source[index + 1];
      if (escaped === undefined) {
        return undefined;
      }
      decoded += escaped;
      index += 1;
      continue;
    }
    decoded += character;
  }

  return inQuotes ? undefined : decoded;
};

const parseTags = (value: string): Map<string, string> | undefined => {
  const tags = new Map<string, string>();
  for (const segment of value.split(";")) {
    const normalizedSegment = segment.trim();
    if (normalizedSegment === "") {
      continue;
    }
    const separatorIndex = normalizedSegment.indexOf("=");
    if (separatorIndex <= 0) {
      return undefined;
    }
    const name = normalizedSegment
      .slice(0, separatorIndex)
      .trim()
      .toLowerCase();
    const tagValue = normalizedSegment.slice(separatorIndex + 1).trim();
    if (name === "" || tags.has(name)) {
      return undefined;
    }
    tags.set(name, tagValue);
  }
  return tags;
};

const parseVersionedTags = (
  value: string,
  version: string
): Map<string, string> | undefined => {
  const firstSegment = value
    .split(";")
    .find((segment) => segment.trim() !== "");
  if (firstSegment === undefined || !/^v\s*=/iu.test(firstSegment)) {
    return undefined;
  }
  const tags = parseTags(value);
  return tags?.get("v")?.toLowerCase() === version.toLowerCase()
    ? tags
    : undefined;
};

const isIpAddress = (hostname: string): boolean => {
  if (!IP_ADDRESS_PATTERN.test(hostname)) {
    return false;
  }
  if (hostname.startsWith("[")) {
    return true;
  }
  return hostname.split(".").every((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
};

const parseHttpsUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hostname === "" ||
      isIpAddress(url.hostname)
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
};

const isSameOrSubdomain = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

type BimiRecord = {
  logoUrl: string;
};

const parseBimiRecord = (value: string): BimiRecord | undefined => {
  const tags = parseVersionedTags(value, BIMI_VERSION);
  if (!tags) {
    return undefined;
  }

  const logoValue = tags.get("l");
  const logoUrl =
    logoValue === undefined ? undefined : parseHttpsUrl(logoValue);
  if (logoUrl === undefined) {
    return undefined;
  }

  const authorityUrl = tags.get("a");
  if (authorityUrl !== undefined && parseHttpsUrl(authorityUrl) === undefined) {
    return undefined;
  }

  return { logoUrl };
};

const parseSelector = (headers: readonly BimiHeader[]): string | undefined => {
  const selectorHeaders = headers.filter(
    (header) => header.name.trim().toLowerCase() === "bimi-selector"
  );
  if (selectorHeaders.length === 0) {
    return "default";
  }
  if (selectorHeaders.length !== 1) {
    return undefined;
  }

  const tags = parseVersionedTags(
    selectorHeaders[0]?.value ?? "",
    BIMI_VERSION
  );
  const selector = tags?.get("s") ?? "default";
  return DNS_LABEL_PATTERN.test(selector) ? selector : undefined;
};

const hasAuthenticatedSender = (
  domain: string,
  headers: readonly BimiHeader[]
): boolean => {
  for (const header of headers) {
    if (header.name.trim().toLowerCase() !== "authentication-results") {
      continue;
    }
    if (!/(?:^|[;\s])dmarc\s*=\s*pass(?:$|[\s;,(])/iu.test(header.value)) {
      continue;
    }
    const fromDomain =
      /\bheader\.from\s*=\s*(?<value>"[^"]+"|[^\s;,)]*)/iu.exec(header.value);
    const rawDomain = fromDomain?.groups?.value;
    const authenticatedDomain = normalizeDomain(
      rawDomain?.replaceAll(/^"|"$/gu, "") ?? ""
    );
    if (authenticatedDomain !== undefined && authenticatedDomain === domain) {
      return true;
    }
  }
  return false;
};

type DmarcPolicy = {
  p: "none" | "quarantine" | "reject";
  pct: number;
  sp?: "none" | "quarantine" | "reject";
};

const parseDmarcRecord = (value: string): DmarcPolicy | undefined => {
  const tags = parseVersionedTags(value, "DMARC1");
  const policy = tags?.get("p")?.toLowerCase();
  if (
    !tags ||
    (policy !== "none" && policy !== "quarantine" && policy !== "reject")
  ) {
    return undefined;
  }

  const subdomainPolicy = tags.get("sp")?.toLowerCase();
  if (
    subdomainPolicy !== undefined &&
    subdomainPolicy !== "none" &&
    subdomainPolicy !== "quarantine" &&
    subdomainPolicy !== "reject"
  ) {
    return undefined;
  }

  const rawPercentage = tags.get("pct");
  const percentage = rawPercentage === undefined ? 100 : Number(rawPercentage);
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) {
    return undefined;
  }

  return {
    p: policy,
    pct: percentage,
    ...(subdomainPolicy === undefined ? {} : { sp: subdomainPolicy }),
  };
};

type DnsLookup = {
  records: string[];
  ttlMs: number;
};

type CacheEntry<TValue> = {
  expiresAt: number;
  value: TValue;
};

type AssetLookup = {
  cacheDurationMs: number;
  value: string | undefined;
};

const getFreshCacheValue = <TValue>(
  cache: Map<string, CacheEntry<TValue>>,
  key: string,
  now: number
): TValue | undefined => {
  const entry = cache.get(key);
  if (entry === undefined) {
    return undefined;
  }
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
};

const getCacheControlMaxAge = (value: string | null): number | undefined => {
  const match = /(?:^|,)\s*max-age\s*=\s*(?<seconds>\d+)/iu.exec(value ?? "");
  const seconds = match?.groups?.seconds;
  if (seconds === undefined) {
    return undefined;
  }
  const duration = Number(seconds) * 1000;
  return Number.isFinite(duration) ? duration : undefined;
};

const getDnsAnswerRecords = (body: unknown): DnsLookup => {
  if (!isRecord(body) || !Array.isArray(body.Answer)) {
    return { records: [], ttlMs: DNS_NEGATIVE_CACHE_MS };
  }

  const records: string[] = [];
  let ttlMs = MAX_CACHE_MS;
  for (const answer of body.Answer) {
    if (!isRecord(answer)) {
      continue;
    }
    const type = getNumber(answer.type);
    const data = getString(answer.data);
    if (type !== DNS_TXT_RECORD_TYPE || data === undefined) {
      continue;
    }
    const decoded = decodeDnsTxtData(data);
    if (decoded !== undefined) {
      records.push(decoded);
    }
    const ttl = getNumber(answer.TTL);
    if (ttl !== undefined && ttl >= 0) {
      ttlMs = Math.min(ttlMs, ttl * 1000);
    }
  }

  return {
    records,
    ttlMs:
      records.length === 0 ? DNS_NEGATIVE_CACHE_MS : clampCacheDuration(ttlMs),
  };
};

const readResponseText = async (
  response: Response,
  maxBytes: number
): Promise<string | undefined> => {
  if (response.body === null) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= maxBytes
      ? text
      : undefined;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      // A response stream can only be consumed one chunk at a time.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        // oxlint-disable-next-line eslint/no-await-in-loop
        await reader.cancel();
        return undefined;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};

const hasContentLengthAboveLimit = (
  response: Response,
  maxBytes: number
): boolean => {
  const contentLength = Number(response.headers.get("content-length"));
  return Number.isFinite(contentLength) && contentLength > maxBytes;
};

type ParsedSvgNode = Record<string, unknown>;

const escapeXmlText = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeXmlAttribute = (value: string): string =>
  escapeXmlText(value).replaceAll('"', "&quot;");

const isSafeAttributeValue = (value: string): boolean => {
  if (
    value.length > MAX_SVG_ATTRIBUTE_LENGTH ||
    (() => {
      for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        if (
          codePoint <= 0x08 ||
          (codePoint >= 0x0b && codePoint <= 0x0c) ||
          (codePoint >= 0x0e && codePoint <= 0x1f) ||
          codePoint === 65_534 ||
          codePoint === 65_535
        ) {
          return true;
        }
      }
      return false;
    })() ||
    /(?:javascript:|data:|file:|ftp:|https?:|expression\s*\(|@import)/iu.test(
      value
    )
  ) {
    return false;
  }

  for (const urlReference of value.matchAll(/url\([^)]*\)/giu)) {
    if (!SAFE_URL_REFERENCE_PATTERN.test(urlReference[0] ?? "")) {
      return false;
    }
  }
  return true;
};

const isSafeLength = (value: string, positive = false): boolean => {
  if (!SAFE_LENGTH_PATTERN.test(value.trim())) {
    return false;
  }
  const numericValue = Number(value.trim().replace(/[a-z%]+$/iu, ""));
  return (
    Number.isFinite(numericValue) &&
    Math.abs(numericValue) <= MAX_SVG_DIMENSION &&
    (!positive || numericValue > 0)
  );
};

const isSafeSvgDimension = (value: string, positive = false): boolean =>
  isSafeLength(value, positive);

const validateRootViewport = (
  attributes: ReadonlyMap<string, string>
): boolean => {
  const viewBox = attributes.get("viewBox");
  if (viewBox !== undefined) {
    const values = viewBox
      .trim()
      .split(/[\s,]+/u)
      .map(Number);
    if (
      values.length !== 4 ||
      values.some((value) => !Number.isFinite(value)) ||
      (values[2] ?? 0) <= 0 ||
      (values[3] ?? 0) <= 0 ||
      (values[2] ?? Number.POSITIVE_INFINITY) > MAX_SVG_DIMENSION ||
      (values[3] ?? Number.POSITIVE_INFINITY) > MAX_SVG_DIMENSION
    ) {
      return false;
    }
  }

  for (const name of ["width", "height"] as const) {
    const value = attributes.get(name);
    if (value !== undefined && !isSafeSvgDimension(value, true)) {
      return false;
    }
  }

  return (
    viewBox !== undefined ||
    (attributes.has("width") && attributes.has("height"))
  );
};

// BIMI's attribute allowlist is intentionally explicit and branches by element.
// oxlint-disable-next-line eslint/complexity
const getSvgAttributes = (
  node: ParsedSvgNode,
  elementName: string,
  isRoot: boolean
): ReadonlyMap<string, string> | undefined => {
  const rawAttributes = node[":@"];
  if (rawAttributes === undefined) {
    return isRoot ? undefined : new Map();
  }
  if (!isRecord(rawAttributes)) {
    return undefined;
  }

  const allowedAttributes = ELEMENT_ATTRIBUTES.get(elementName);
  if (allowedAttributes === undefined) {
    return undefined;
  }

  const attributes = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(rawAttributes)) {
    if (!rawName.startsWith("@_")) {
      return undefined;
    }
    const name = rawName.slice(2);
    const value = getString(rawValue);
    const isSafeNamespace =
      name === "xmlns" && value === "http://www.w3.org/2000/svg";
    if (
      value === undefined ||
      !allowedAttributes.has(name) ||
      (!isSafeNamespace && !isSafeAttributeValue(value)) ||
      attributes.has(name)
    ) {
      return undefined;
    }
    if (name === "id" && !SAFE_ID_PATTERN.test(value)) {
      return undefined;
    }
    if (
      [
        "cx",
        "cy",
        "dx",
        "dy",
        "fx",
        "fy",
        "height",
        "r",
        "rx",
        "ry",
        "stroke-width",
        "textLength",
        "width",
        "x",
        "x1",
        "x2",
        "y",
        "y1",
        "y2",
      ].includes(name) &&
      !isSafeLength(value)
    ) {
      return undefined;
    }
    if (
      name === "xmlns" &&
      (elementName !== "svg" || value !== "http://www.w3.org/2000/svg")
    ) {
      return undefined;
    }
    if (
      (name === "version" && (elementName !== "svg" || value !== "1.2")) ||
      (name === "baseProfile" &&
        (elementName !== "svg" || value !== "tiny-ps")) ||
      (name === "zoomAndPan" && value !== "disable") ||
      (name === "externalResourcesRequired" && value !== "false")
    ) {
      return undefined;
    }
    attributes.set(name, value);
  }

  return attributes;
};

type SvgSanitizerState = {
  hasViewport: boolean;
  titleCount: number;
};

// The serializer validates and rebuilds the complete tree so rejected XML never reaches the client.
// oxlint-disable-next-line eslint/complexity
const serializeSvgNode = (
  node: unknown,
  depth: number,
  state: SvgSanitizerState
): string | undefined => {
  if (!isRecord(node)) {
    return undefined;
  }

  const textValue = node["#text"];
  const elementEntries = Object.entries(node).filter(
    ([name]) => name !== ":@" && name !== "#text"
  );
  if (elementEntries.length === 0) {
    return typeof textValue === "string" ? escapeXmlText(textValue) : undefined;
  }
  if (elementEntries.length !== 1) {
    return undefined;
  }

  const [elementName, rawChildren] = elementEntries[0] ?? [];
  if (
    elementName === undefined ||
    !Array.isArray(rawChildren) ||
    !ELEMENT_ATTRIBUTES.has(elementName)
  ) {
    return undefined;
  }
  const isRoot = depth === 0;
  if (isRoot && elementName !== "svg") {
    return undefined;
  }
  if (!isRoot && elementName === "svg") {
    return undefined;
  }
  if (elementName === "title") {
    if (depth !== 1 || state.titleCount > 0) {
      return undefined;
    }
    state.titleCount += 1;
  }

  const attributes = getSvgAttributes(node, elementName, isRoot);
  if (attributes === undefined) {
    return undefined;
  }
  if (isRoot) {
    if (
      attributes.get("xmlns") !== "http://www.w3.org/2000/svg" ||
      attributes.get("version") !== "1.2" ||
      attributes.get("baseProfile") !== "tiny-ps" ||
      !validateRootViewport(attributes)
    ) {
      return undefined;
    }
    state.hasViewport = true;
  }

  const serializedChildren: string[] = [];
  for (const child of rawChildren) {
    const serializedChild = serializeSvgNode(child, depth + 1, state);
    if (serializedChild === undefined) {
      return undefined;
    }
    serializedChildren.push(serializedChild);
  }
  if (elementName === "title" && serializedChildren.join("").trim() === "") {
    return undefined;
  }

  const serializedAttributes = [...attributes.entries()]
    .map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
    .join("");
  const children = serializedChildren.join("");
  return children === ""
    ? `<${elementName}${serializedAttributes}/>`
    : `<${elementName}${serializedAttributes}>${children}</${elementName}>`;
};

export const sanitizeBimiSvg = (svg: string): string | undefined => {
  if (
    new TextEncoder().encode(svg).byteLength > MAX_SVG_BYTES ||
    /<!doctype|<!entity|<\?xml-stylesheet/iu.test(svg)
  ) {
    return undefined;
  }
  if (XMLValidator.validate(svg, { allowBooleanAttributes: false }) !== true) {
    return undefined;
  }

  try {
    const parser = new XMLParser({
      attributeNamePrefix: "@_",
      ignoreAttributes: false,
      ignoreDeclaration: true,
      ignorePiTags: true,
      parseAttributeValue: false,
      parseTagValue: false,
      preserveOrder: true,
      processEntities: false,
      textNodeName: "#text",
      trimValues: false,
    });
    const parsed: unknown = parser.parse(svg);
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    const significantNodes = parsed.filter((node) => {
      if (!isRecord(node)) {
        return false;
      }
      return !("#text" in node && Object.keys(node).length === 1);
    });
    if (significantNodes.length !== 1) {
      return undefined;
    }

    const state: SvgSanitizerState = { hasViewport: false, titleCount: 0 };
    const sanitized = serializeSvgNode(significantNodes[0], 0, state);
    return sanitized !== undefined &&
      state.hasViewport &&
      state.titleCount === 1
      ? sanitized
      : undefined;
  } catch {
    return undefined;
  }
};

export type BimiHeader = {
  name: string;
  value: string;
};

export type BimiResolver = {
  clear: () => void;
  resolve: (input: {
    domain: string;
    headers: readonly BimiHeader[];
  }) => Promise<string | undefined>;
};

export type BimiResolverOptions = {
  assetHostnames?: readonly string[];
  dnsEndpoint?: string;
  fetch?: typeof fetch;
  now?: () => number;
};

export const createBimiResolver = (
  options: BimiResolverOptions = {}
): BimiResolver => {
  const fetchImpl: typeof fetch =
    options.fetch ??
    (async (input, init) => await globalThis.fetch(input, init));
  const now = options.now ?? Date.now;
  const dnsEndpoint = options.dnsEndpoint ?? DNS_OVER_HTTPS_ENDPOINT;
  const assetHostnames = new Set(
    (options.assetHostnames ?? []).map((hostname) => hostname.toLowerCase())
  );
  const dnsCache = new Map<string, CacheEntry<DnsLookup>>();
  const dnsInflight = new Map<string, Promise<DnsLookup>>();
  const assetCache = new Map<string, CacheEntry<string | undefined>>();
  const assetInflight = new Map<string, Promise<AssetLookup>>();

  const lookupDns = async (name: string): Promise<DnsLookup> => {
    const cached = getFreshCacheValue(dnsCache, name, now());
    if (cached !== undefined) {
      return cached;
    }
    const pending = dnsInflight.get(name);
    if (pending !== undefined) {
      return await pending;
    }

    const request = (async () => {
      try {
        const url = new URL(dnsEndpoint);
        url.searchParams.set("name", name);
        url.searchParams.set("type", "TXT");
        const response = await fetchImpl(url, {
          headers: { accept: "application/dns-json" },
          redirect: "error",
          signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
        });
        if (!response.ok) {
          return { records: [], ttlMs: DNS_NEGATIVE_CACHE_MS };
        }
        return getDnsAnswerRecords(await response.json());
      } catch {
        return { records: [], ttlMs: DNS_NEGATIVE_CACHE_MS };
      }
    })();
    dnsInflight.set(name, request);
    const result = await request;
    dnsInflight.delete(name);
    dnsCache.set(name, {
      expiresAt: now() + result.ttlMs,
      value: result,
    });
    return result;
  };

  const findDmarcPolicy = async (
    domain: string
  ): Promise<{ domain: string; policy: DmarcPolicy } | undefined> => {
    for (const candidate of getDomainCandidates(domain)) {
      // Candidate lookups must remain ordered so a subdomain policy wins over its parent.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const result = await lookupDns(`_dmarc.${candidate}`);
      const policies = result.records
        .map(parseDmarcRecord)
        .filter((policy): policy is DmarcPolicy => policy !== undefined);
      const [policy] = policies;
      if (policies.length === 1 && policy !== undefined) {
        return { domain: candidate, policy };
      }
    }
    return undefined;
  };

  const hasEnforcedDmarc = async (domain: string): Promise<boolean> => {
    const result = await findDmarcPolicy(domain);
    if (result === undefined || result.policy.pct < 100) {
      return false;
    }
    const policy =
      result.domain === domain
        ? result.policy.p
        : (result.policy.sp ?? result.policy.p);
    return policy === "quarantine" || policy === "reject";
  };

  const lookupBimiRecord = async (
    selector: string,
    domain: string
  ): Promise<BimiRecord | undefined> => {
    const result = await lookupDns(`${selector}._bimi.${domain}`);
    const bimiRecords = result.records.filter(
      (record) => parseVersionedTags(record, BIMI_VERSION) !== undefined
    );
    if (bimiRecords.length !== 1) {
      return undefined;
    }
    const record = parseBimiRecord(bimiRecords[0] ?? "");
    if (record === undefined) {
      return undefined;
    }
    const assetHostname = new URL(record.logoUrl).hostname.toLowerCase();
    return [...assetHostnames].some((hostname) =>
      isSameOrSubdomain(assetHostname, hostname)
    )
      ? record
      : undefined;
  };

  const fetchAsset = async (url: string): Promise<string | undefined> => {
    const cached = getFreshCacheValue(assetCache, url, now());
    if (cached !== undefined || assetCache.has(url)) {
      return cached;
    }
    const pending = assetInflight.get(url);
    if (pending !== undefined) {
      return await pending.then((result) => result.value);
    }

    const request = (async (): Promise<AssetLookup> => {
      try {
        const response = await fetchImpl(url, {
          headers: { accept: "image/svg+xml" },
          redirect: "error",
          signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
        });
        const contentType = response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        const cacheDurationMs = clampCacheDuration(
          getCacheControlMaxAge(response.headers.get("cache-control")) ??
            DEFAULT_ASSET_CACHE_MS
        );
        if (!response.ok || contentType !== "image/svg+xml") {
          return { cacheDurationMs, value: undefined };
        }
        if (hasContentLengthAboveLimit(response, MAX_SVG_BYTES)) {
          return { cacheDurationMs, value: undefined };
        }
        const source = await readResponseText(response, MAX_SVG_BYTES);
        const sanitized =
          source === undefined ? undefined : sanitizeBimiSvg(source);
        return {
          cacheDurationMs,
          value:
            sanitized === undefined
              ? undefined
              : `data:image/svg+xml,${encodeURIComponent(sanitized)}`,
        };
      } catch {
        return {
          cacheDurationMs: DEFAULT_ASSET_CACHE_MS,
          value: undefined,
        };
      }
    })();
    assetInflight.set(url, request);
    const result = await request;
    assetInflight.delete(url);
    assetCache.set(url, {
      expiresAt: now() + result.cacheDurationMs,
      value: result.value,
    });
    return result.value;
  };

  const resolve = async (input: {
    domain: string;
    headers: readonly BimiHeader[];
  }): Promise<string | undefined> => {
    const domain = normalizeDomain(input.domain);
    if (
      domain === undefined ||
      !hasAuthenticatedSender(domain, input.headers)
    ) {
      return undefined;
    }
    const selector = parseSelector(input.headers);
    if (selector === undefined) {
      return undefined;
    }

    for (const candidateDomain of getDomainCandidates(domain)) {
      // BIMI lookup falls back from the author domain to the organizational domain.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const record = await lookupBimiRecord(selector, candidateDomain);
      if (
        record === undefined ||
        // oxlint-disable-next-line eslint/no-await-in-loop
        !(await hasEnforcedDmarc(candidateDomain))
      ) {
        continue;
      }
      // Keep the first valid assertion record's precedence over broader fallback domains.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const asset = await fetchAsset(record.logoUrl);
      if (asset !== undefined) {
        return asset;
      }
    }
    return undefined;
  };

  return {
    clear: () => {
      dnsCache.clear();
      dnsInflight.clear();
      assetCache.clear();
      assetInflight.clear();
    },
    resolve,
  };
};
