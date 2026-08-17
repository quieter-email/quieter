import type { AutomationMailMessage } from "@quieter/ai/classify-gmail-message";

import { hasText } from "../text";
import { getMailPlainText } from "./message-text";
import { getSenderServiceName } from "./sender";

const MIN_CODE_LENGTH = 4;
const MAX_CODE_LENGTH = 10;
const MAX_GROUPS = 8;
const MAX_GROUP_LENGTH = 4;
const MAX_ANCHOR_DISTANCE = 48;
const QUALIFIER_LOOKBEHIND = 32;
const MAX_UNKNOWN_GAP_WORDS = 1;
/**
 * Two readings of the same message must not tie. When the best and second-best
 * codes are this close the message is ambiguous, and the fast path gives up so
 * the model can read it instead. A wrong code is far worse than a slow one.
 */
const SCORE_MARGIN = 12;

const DEFAULT_VALIDITY_MS = 1000 * 60 * 30;
const MIN_VALIDITY_MS = 1000 * 60;
const MAX_VALIDITY_MS = 1000 * 60 * 60 * 2;

const BEFORE_ANCHOR_SCORE = 100;
const AFTER_ANCHOR_SCORE = 88;
const STANDALONE_SCORE = 62;
const SUBJECT_BONUS = 6;
const OWN_LINE_BONUS = 8;
const REPEAT_BONUS = 4;
const MAX_REPEAT_BONUS = 8;

/**
 * Structures that contain digits but never contain a verification code. They
 * are blanked before scanning so their digits cannot be read as a candidate,
 * and so a label can never reach across them to a real code.
 */
const SCRUB_PATTERNS = [
  /\S*:\/\/\S+/gu,
  /\bwww\.\S+/giu,
  /[^\s<>()[\]]+@[^\s<>()[\]]+\.\p{L}{2,}/gu,
  /\+\d[\d ()/-]{5,}\d/gu,
  /\b\d{1,4}[./]\d{1,2}[./]\d{1,4}\b/gu,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/gu,
  /[$£¥€]\s?\d[\d.,]*/gu,
  /\b\d[\d.,]*\s?(?:CHF|EUR|GBP|USD|%|€)\b/giu,
  /\b\d+[.,]\d+\b/gu,
];

const CODE_WORD_PATTERN =
  /\b(?<word>[\p{L}-]{0,20}(?:code|codigo|código|codice|kennwort|passwor[dt])|otp|pin)\b/giu;
/**
 * Labels that introduce a durable identifier or an amount. A candidate whose
 * nearest label is one of these is never a verification code.
 */
const REFERENCE_WORD_PATTERN =
  /\b(?:aktenzeichen|amount|auftrag\p{L}*|beleg\p{L}*|bestell\p{L}*|betrag|booking|buchung\p{L}*|case|claim|client|contract|customer|iban|invoice|konto\p{L}*|kunde\p{L}*|licen[cs]e|member\p{L}*|mitglied\p{L}*|nr|nummer|number|order|policy|preis|price|receipt|reference|referenz|rechnung\p{L}*|reservation|sendung\p{L}*|serial|shipment|summe|tax|ticket|total|tracking|transaction|vat|vertrag\p{L}*|vorgang\p{L}*)\b/giu;
/**
 * Compounds that mean the matched code word is not an access code. German and
 * Dutch put the qualifier first ("Rabattcode"), so containment is checked.
 */
const NEGATIVE_CODE_WORD_PATTERN =
  /aktion|area|artikel|barcode|bestell|colo|country|dial|discount|einladung|error|farb|fehler|filial|geschenk|gift|gutschein|iata|iban|invite|kunden|land|plz|post|produkt|product|promo|qr|rabatt|referral|sendung|shop|sku|sort|source|status|swift|track|unicode|voucher|vorwahl|zeichen|zip/iu;
const ONE_TIME_PATTERN =
  /einmal|onetime|one-time|otp|security|sicherheit|single|temporar|temporär/iu;
const PASSWORD_WORD_PATTERN = /kennwort|passwor[dt]/iu;

/**
 * A message must say what the code is for. Without one of these the fast path
 * stays silent and the model decides, because a bare "code" is just as likely
 * to introduce a discount as a login.
 */
const INTENT_PATTERN =
  /\b(?:2fa|anmelde\p{L}*|anmeldung|authenticat\p{L}*|authentifizier\p{L}*|autenticaci\p{L}*|bestätig\p{L}*|conectar|confirm\p{L}*|connexion|einmalig\p{L}*|identifi\p{L}*|identit(?:ät|y)|ingresar|log[- ]?in|one[- ]?time|otp|passcode|secur\p{L}*|sécurité|seguridad|sicherheits\p{L}*|sign[- ]?in|two[- ]?factor|vérific\p{L}*|verific\p{L}*|verifizier\p{L}*|verify|zwei[- ]?faktor)\b/iu;

/**
 * Words that may sit between a label and its code without changing what the
 * label refers to. Anything else, including any other number, breaks the link.
 * This allowlist is what stops "code is 944688" from reading as "is944688".
 */
const CONNECTOR_WORDS = new Set([
  "a",
  "access",
  "an",
  "and",
  "anmelde",
  "anmeldung",
  "at",
  "authentication",
  "authentifizierung",
  "below",
  "bestätigung",
  "bestätigungs",
  "bitte",
  "confirmation",
  "das",
  "de",
  "dein",
  "deine",
  "deinen",
  "dem",
  "den",
  "der",
  "des",
  "die",
  "du",
  "ein",
  "eine",
  "einen",
  "einmal",
  "einmalig",
  "einmalige",
  "einmaliger",
  "einmaliges",
  "el",
  "enter",
  "es",
  "est",
  "et",
  "folgende",
  "folgenden",
  "folgender",
  "folgendes",
  "following",
  "for",
  "für",
  "geben",
  "gib",
  "here",
  "hier",
  "identity",
  "ihr",
  "ihre",
  "ihren",
  "in",
  "is",
  "ist",
  "lautet",
  "lauten",
  "login",
  "mein",
  "meine",
  "my",
  "neu",
  "neue",
  "neuen",
  "neuer",
  "neues",
  "new",
  "now",
  "la",
  "le",
  "les",
  "of",
  "one",
  "onetime",
  "our",
  "para",
  "pour",
  "personal",
  "persönlich",
  "persönlicher",
  "please",
  "reads",
  "security",
  "sich",
  "sicherheits",
  "sie",
  "sign",
  "signin",
  "single",
  "temporary",
  "temporär",
  "su",
  "the",
  "this",
  "to",
  "tu",
  "un",
  "una",
  "unten",
  "use",
  "used",
  "verificacion",
  "verificación",
  "verification",
  "verifizierung",
  "verifizierungs",
  "verify",
  "vérification",
  "von",
  "votre",
  "was",
  "your",
  "yours",
  "zum",
  "zur",
]);

const VALIDITY_UNIT_MS = {
  hour: 1000 * 60 * 60,
  minute: 1000 * 60,
  second: 1000,
} as const;
const VALIDITY_UNIT_SOURCE =
  "(?<unit>seconds?|sekunden?|sek|minutes?|minuten?|mins?|hours?|stunden?|std)";
const VALIDITY_AFTER_PATTERN = new RegExp(
  `(?:valid|expir\\p{L}*|gültig|läuft|verfäll\\p{L}*|ablauf|innerhalb|within)[^\\n]{0,40}?(?<amount>\\d{1,3})\\s?${VALIDITY_UNIT_SOURCE}\\b`,
  "iu"
);
const VALIDITY_BEFORE_PATTERN = new RegExp(
  `(?<amount>\\d{1,3})\\s?${VALIDITY_UNIT_SOURCE}\\b[^\\n]{0,24}?(?:valid|gültig|expir\\p{L}*|verfäll\\p{L}*|läuft)`,
  "iu"
);

const CODE_WORD_TEST_PATTERN = new RegExp(CODE_WORD_PATTERN.source, "iu");
const REFERENCE_WORD_TEST_PATTERN = new RegExp(
  REFERENCE_WORD_PATTERN.source,
  "iu"
);

const ALPHANUMERIC_RUN_PATTERN = /[\dA-Za-z]+/gu;
const LEADING_ALPHANUMERIC_RUN = /^[\dA-Za-z]+/u;
const CODE_SEPARATOR_PATTERN = /[ -]/gu;
const REJECTED_PRECEDING_CHARACTER = /[\p{L}\p{N}$%&+./:=@\\_£¥€]/u;
const REJECTED_FOLLOWING_CHARACTER = /[\p{L}\p{N}$%&+/@\\_£¥€]/u;
const DIGIT_PATTERN = /\d/u;
const UPPERCASE_RUN_PATTERN = /^[\dA-Z]+$/u;
const YEAR_PATTERN = /^(?:19|20)\d{2}$/u;
const CALENDAR_PATTERN =
  /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/u;

type AnchorKind = "negative" | "positive";
type Anchor = { end: number; kind: AnchorKind; start: number };
type AnchorIndex = { anchors: Anchor[]; maxLength: number };
type AnchorCursor = (
  text: string,
  start: number,
  end: number
) => { after: Anchor | null; before: Anchor | null };
type CodeCandidate = { code: string; score: number };
type CodeToken = { end: number; start: number; value: string };
type CodeGroups = { end: number; groupLength: number; value: string };

/**
 * Replaces each scrubbed run with spaces of the same length so that every
 * offset, line break and adjacency in the scanned text stays intact.
 */
const scrubStructuredValues = (text: string) => {
  let scrubbed = text;
  for (const pattern of SCRUB_PATTERNS) {
    scrubbed = scrubbed.replaceAll(pattern, (match) =>
      " ".repeat(match.length)
    );
  }
  return scrubbed;
};

/**
 * A code word means nothing on its own: "Rabattcode", "promo code" and "gift
 * card code" all introduce something the reader must never be handed as a
 * login code. The word itself and the two words before it are checked, because
 * German compounds the qualifier and English separates it.
 */
const classifyCodeWord = (word: string, preceding: string) => {
  const normalized = word.toLowerCase().replaceAll("-", "");
  const qualifiers = (preceding.toLowerCase().match(/[\p{L}]+/gu) ?? []).slice(
    -2
  );
  if (
    NEGATIVE_CODE_WORD_PATTERN.test(normalized) ||
    qualifiers.some(
      (qualifier) =>
        NEGATIVE_CODE_WORD_PATTERN.test(qualifier) ||
        REFERENCE_WORD_TEST_PATTERN.test(qualifier)
    )
  ) {
    return "negative" as const;
  }
  if (
    PASSWORD_WORD_PATTERN.test(normalized) &&
    !ONE_TIME_PATTERN.test(normalized) &&
    !qualifiers.some((qualifier) => ONE_TIME_PATTERN.test(qualifier))
  ) {
    return "negative" as const;
  }
  return "positive" as const;
};

const collectAnchors = (text: string): AnchorIndex => {
  const anchors: Anchor[] = [];
  let maxLength = 0;

  for (const match of text.matchAll(CODE_WORD_PATTERN)) {
    const start = match.index ?? 0;
    anchors.push({
      end: start + match[0].length,
      kind: classifyCodeWord(
        match.groups?.word ?? match[0],
        text.slice(Math.max(0, start - QUALIFIER_LOOKBEHIND), start)
      ),
      start,
    });
    maxLength = Math.max(maxLength, match[0].length);
  }
  for (const match of text.matchAll(REFERENCE_WORD_PATTERN)) {
    const start = match.index ?? 0;
    anchors.push({ end: start + match[0].length, kind: "negative", start });
    maxLength = Math.max(maxLength, match[0].length);
  }

  return {
    anchors: anchors.toSorted((left, right) => left.start - right.start),
    maxLength,
  };
};

/**
 * Text between a label and its code may only be connective. One unrecognized
 * word is tolerated so that a brand name ("483921 is your Slack code") does not
 * break the link, but a number, an identifier word or anything more than that
 * means the label and the code are not talking about each other.
 */
const isConnectorGap = (gap: string) => {
  if (gap.length > MAX_ANCHOR_DISTANCE) {
    return false;
  }

  let unknown = 0;
  for (const word of gap.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const normalized = word.toLowerCase();
    if (CONNECTOR_WORDS.has(normalized)) {
      continue;
    }
    if (
      DIGIT_PATTERN.test(normalized) ||
      REFERENCE_WORD_TEST_PATTERN.test(normalized) ||
      NEGATIVE_CODE_WORD_PATTERN.test(normalized)
    ) {
      return false;
    }
    unknown += 1;
    if (unknown > MAX_UNKNOWN_GAP_WORDS) {
      return false;
    }
  }

  return true;
};

const isJoinableGroup = (group: string, first: string, length: number) =>
  group.length === first.length &&
  group.length <= MAX_GROUP_LENGTH &&
  length + group.length <= MAX_CODE_LENGTH &&
  DIGIT_PATTERN.test(group);

/**
 * Reads a code starting at `start`, joining evenly sized groups so "944688",
 * "944 688", "9-4-4-6-8-8" and "AB12 CD34" all read as the same value. Every
 * group must match the first group's length and carry a digit, which is what
 * keeps an adjacent word or an unrelated number from being absorbed.
 */
const readCodeGroups = (text: string, start: number): CodeGroups | null => {
  const first = LEADING_ALPHANUMERIC_RUN.exec(
    text.slice(start, start + MAX_CODE_LENGTH + 1)
  )?.[0];
  if (first === undefined || first.length > MAX_CODE_LENGTH) {
    return null;
  }

  const groups = [first];
  let cursor = start + first.length;
  let { length } = first;

  while (groups.length < MAX_GROUPS) {
    const separator = text[cursor];
    if (separator !== " " && separator !== "-") {
      break;
    }
    const group = LEADING_ALPHANUMERIC_RUN.exec(
      text.slice(cursor + 1, cursor + 1 + MAX_GROUP_LENGTH + 1)
    )?.[0];
    if (group === undefined || !isJoinableGroup(group, first, length)) {
      break;
    }

    groups.push(group);
    length += group.length;
    cursor += 1 + group.length;
  }

  return { end: cursor, groupLength: first.length, value: groups.join("") };
};

/**
 * Year- and date-shaped values are dropped even when a label points straight at
 * them. A handful of real four-digit PINs are lost, which is the cheaper
 * mistake: a copyright year on a card is not.
 */
const isCodeShaped = (value: string) => {
  const core = value.replaceAll(CODE_SEPARATOR_PATTERN, "");
  return (
    core.length >= MIN_CODE_LENGTH &&
    core.length <= MAX_CODE_LENGTH &&
    DIGIT_PATTERN.test(core) &&
    !YEAR_PATTERN.test(core) &&
    !CALENDAR_PATTERN.test(core)
  );
};

const hasValidBoundaries = (text: string, start: number, end: number) =>
  !REJECTED_PRECEDING_CHARACTER.test(text[start - 1] ?? " ") &&
  !REJECTED_FOLLOWING_CHARACTER.test(text[end] ?? " ") &&
  !(
    /[,.:-]/u.test(text[end] ?? " ") && DIGIT_PATTERN.test(text[end + 1] ?? " ")
  );

const isLabelLikeRun = (run: string) =>
  CONNECTOR_WORDS.has(run.toLowerCase()) ||
  CODE_WORD_TEST_PATTERN.test(run) ||
  REFERENCE_WORD_TEST_PATTERN.test(run);

/**
 * An adjacent run of the same width that carries no digit is either the other
 * half of a grouped code or an unrelated word. Because the two readings cannot
 * be told apart, the candidate is dropped rather than guessed at.
 */
const hasAmbiguousPeer = (
  text: string,
  start: number,
  end: number,
  width: number
) => {
  const before = text.slice(Math.max(0, start - width - 1), start);
  const after = text.slice(end, end + width + 1);
  const peers = [
    before.length === width + 1 && /[ -]$/u.test(before)
      ? before.slice(0, width)
      : null,
    after.length === width + 1 && /^[ -]/u.test(after) ? after.slice(1) : null,
  ];

  return peers.some(
    (peer) =>
      peer !== null &&
      UPPERCASE_RUN_PATTERN.test(peer) &&
      !DIGIT_PATTERN.test(peer) &&
      !isLabelLikeRun(peer)
  );
};

/**
 * Walks the sorted anchors alongside the tokens, which are also in reading
 * order, so a long message costs one pass rather than one pass per number. No
 * message is too long to scan, and a code below a newsletter is still found.
 */
const createAnchorCursor = ({ anchors, maxLength }: AnchorIndex) => {
  let windowStart = 0;

  return (text: string, start: number, end: number) => {
    const lowerBound = start - MAX_ANCHOR_DISTANCE - maxLength;
    while (
      (anchors[windowStart]?.start ?? Number.POSITIVE_INFINITY) < lowerBound
    ) {
      windowStart += 1;
    }

    let before: Anchor | null = null;
    let after: Anchor | null = null;
    for (let index = windowStart; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      if (anchor === undefined || anchor.start > end + MAX_ANCHOR_DISTANCE) {
        break;
      }
      if (
        anchor.end <= start &&
        start - anchor.end <= MAX_ANCHOR_DISTANCE &&
        isConnectorGap(text.slice(anchor.end, start))
      ) {
        before = anchor;
      }
      if (
        after === null &&
        anchor.start >= end &&
        isConnectorGap(text.slice(end, anchor.start))
      ) {
        after = anchor;
      }
    }

    return { after, before };
  };
};

const getShapeScore = (code: string) => {
  if (/^\d{6}$/u.test(code)) {
    return 12;
  }
  if (/^\d{4,8}$/u.test(code)) {
    return 9;
  }
  if (/^[\dA-Za-z]{5,8}$/u.test(code)) {
    return 6;
  }
  return 2;
};

const isOwnLine = (text: string, start: number, end: number) => {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", end);
  return (
    text.slice(lineStart, start).trim() === "" &&
    text.slice(end, lineEnd === -1 ? text.length : lineEnd).trim() === ""
  );
};

/**
 * Resolves what a code-shaped value is. A value the message explains as an
 * order or customer number is `identified`: not a code, but not a source of
 * doubt either. A value nothing explains stays unresolved, and an unresolved
 * neighbour is what makes a nearby code ambiguous.
 */
const resolveToken = ({
  findAnchors,
  hasIntent,
  ownLine,
  text,
  token,
}: {
  findAnchors: AnchorCursor;
  hasIntent: boolean;
  ownLine: boolean;
  text: string;
  token: CodeToken;
}) => {
  const { after, before } = findAnchors(text, token.start, token.end);
  const anchor = before ?? after;

  if (anchor === null) {
    return {
      identified: false,
      score: ownLine && hasIntent ? STANDALONE_SCORE : null,
    };
  }
  if (anchor.kind === "negative") {
    return { identified: true, score: null };
  }

  return {
    identified: true,
    score: before === null ? AFTER_ANCHOR_SCORE : BEFORE_ANCHOR_SCORE,
  };
};

const collectCodeTokens = (text: string) => {
  const tokens: CodeToken[] = [];
  let scanIndex = 0;

  for (const match of text.matchAll(ALPHANUMERIC_RUN_PATTERN)) {
    const start = match.index ?? 0;
    if (start < scanIndex || !DIGIT_PATTERN.test(match[0])) {
      continue;
    }

    const group = readCodeGroups(text, start);
    if (group === null) {
      continue;
    }
    scanIndex = group.end;
    if (
      isCodeShaped(group.value) &&
      hasValidBoundaries(text, start, group.end) &&
      !hasAmbiguousPeer(text, start, group.end, group.groupLength)
    ) {
      tokens.push({ end: group.end, start, value: group.value });
    }
  }

  return tokens;
};

/**
 * An unexplained code-shaped value a connective phrase away ("code 112233 or
 * 445566") means the label points at both, so neither can be trusted. A
 * neighbour the message identifies as something else does not compete.
 */
const hasUnresolvedNeighbor = ({
  index,
  resolutions,
  text,
  tokens,
}: {
  index: number;
  resolutions: { identified: boolean }[];
  text: string;
  tokens: CodeToken[];
}) => {
  const token = tokens[index];
  if (token === undefined) {
    return false;
  }

  return [index - 1, index + 1].some((neighborIndex) => {
    const neighbor = tokens[neighborIndex];
    if (
      neighbor === undefined ||
      neighbor.value === token.value ||
      resolutions[neighborIndex]?.identified
    ) {
      return false;
    }
    return isConnectorGap(
      neighbor.start > token.start
        ? text.slice(token.end, neighbor.start)
        : text.slice(neighbor.end, token.start)
    );
  });
};

const collectCandidates = ({
  anchorIndex,
  hasIntent,
  sectionBonus,
  text,
}: {
  anchorIndex: AnchorIndex;
  hasIntent: boolean;
  sectionBonus: number;
  text: string;
}) => {
  const tokens = collectCodeTokens(text);
  const findAnchors = createAnchorCursor(anchorIndex);
  const resolutions = tokens.map((token) =>
    resolveToken({
      findAnchors,
      hasIntent,
      ownLine: isOwnLine(text, token.start, token.end),
      text,
      token,
    })
  );
  const candidates: CodeCandidate[] = [];

  for (const [index, token] of tokens.entries()) {
    const score = resolutions[index]?.score;
    if (
      score === null ||
      score === undefined ||
      hasUnresolvedNeighbor({ index, resolutions, text, tokens })
    ) {
      continue;
    }

    const ownLine = isOwnLine(text, token.start, token.end);
    candidates.push({
      code: token.value,
      score:
        score +
        sectionBonus +
        getShapeScore(token.value) +
        (ownLine ? OWN_LINE_BONUS : 0),
    });
  }

  return candidates;
};

const selectCode = (candidates: CodeCandidate[]) => {
  const scores = new Map<string, number>();
  const repeats = new Map<string, number>();

  for (const candidate of candidates) {
    scores.set(
      candidate.code,
      Math.max(scores.get(candidate.code) ?? 0, candidate.score)
    );
    repeats.set(candidate.code, (repeats.get(candidate.code) ?? 0) + 1);
  }

  const ranked = [...scores.entries()]
    .map(([code, score]) => ({
      code,
      score:
        score +
        Math.min(
          MAX_REPEAT_BONUS,
          ((repeats.get(code) ?? 1) - 1) * REPEAT_BONUS
        ),
    }))
    .toSorted((left, right) => right.score - left.score);

  const [best, runnerUp] = ranked;
  if (best === undefined) {
    return null;
  }
  if (runnerUp !== undefined && best.score - runnerUp.score < SCORE_MARGIN) {
    return null;
  }

  return best.code;
};

const getValidityUnitMs = (unit: string) => {
  if (unit.startsWith("sec") || unit.startsWith("sek")) {
    return VALIDITY_UNIT_MS.second;
  }
  if (unit.startsWith("hour") || unit.startsWith("stund") || unit === "std") {
    return VALIDITY_UNIT_MS.hour;
  }
  return VALIDITY_UNIT_MS.minute;
};

const parseValidity = (text: string) => {
  const match =
    VALIDITY_AFTER_PATTERN.exec(text) ?? VALIDITY_BEFORE_PATTERN.exec(text);
  const amount = Number(match?.groups?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Math.min(
    MAX_VALIDITY_MS,
    Math.max(
      MIN_VALIDITY_MS,
      amount * getValidityUnitMs((match?.groups?.unit ?? "").toLowerCase())
    )
  );
};

export type VerificationCodeExtraction = {
  code: string;
  hasExplicitValidity: boolean;
  service: string | null;
  validForMs: number;
};

/**
 * Reads a verification code straight from the message, with no model call.
 *
 * Every candidate must be anchored to a code label through connective words
 * only, or stand alone on its own line in a message that is clearly about
 * verification. Two plausible codes with similar support means the message is
 * ambiguous, and the extractor returns null so the model can read it instead.
 */
export const extractVerificationCode = (
  message: AutomationMailMessage
): VerificationCodeExtraction | null => {
  const { body, subject } = getMailPlainText(message);
  if (!hasText(body) && !hasText(subject)) {
    return null;
  }

  // No stated purpose, no code. A discount code and a login code look
  // identical on the page, so silence here is what keeps the wrong one out.
  const hasIntent = INTENT_PATTERN.test(subject) || INTENT_PATTERN.test(body);
  if (!hasIntent) {
    return null;
  }

  const candidates = [
    { bonus: SUBJECT_BONUS, text: scrubStructuredValues(subject) },
    { bonus: 0, text: scrubStructuredValues(body) },
  ].flatMap(({ bonus, text }) =>
    collectCandidates({
      anchorIndex: collectAnchors(text),
      hasIntent,
      sectionBonus: bonus,
      text,
    })
  );

  const code = selectCode(candidates);
  if (code === null) {
    return null;
  }

  const validForMs = parseValidity(`${subject}\n${body}`);
  return {
    code,
    hasExplicitValidity: validForMs !== null,
    service: getSenderServiceName(message.from),
    validForMs: validForMs ?? DEFAULT_VALIDITY_MS,
  };
};
