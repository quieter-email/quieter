import type { MailSearchFilter, StructuredMailSearch } from "./search";
import { normalizeStructuredMailSearch, normalizeSearchText } from "./search";

export type NaturalLanguageMailSearchResult = StructuredMailSearch;

const FILLER_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "any",
  "are",
  "contain",
  "containing",
  "contains",
  "email",
  "emails",
  "find",
  "got",
  "has",
  "have",
  "in",
  "is",
  "mail",
  "mails",
  "me",
  "message",
  "messages",
  "my",
  "of",
  "please",
  "show",
  "some",
  "that",
  "the",
  "things",
  "which",
  "with",
]);

const NEGATOR_WORDS = new Set(["except", "no", "not", "without"]);

const CAPTURE_STOP_WORDS = new Set(["about", "concerning", "regarding"]);

type FixedFilterPhrase = {
  filter: Omit<MailSearchFilter, "negated">;
  phrase: string;
};

const FIXED_FILTER_PHRASE_TABLE: FixedFilterPhrase[] = [
  { filter: { type: "is", value: "unread" }, phrase: "not read" },
  { filter: { type: "is", value: "unread" }, phrase: "unopened" },
  { filter: { type: "is", value: "unread" }, phrase: "unread" },
  { filter: { type: "has", value: "attachment" }, phrase: "attachment" },
  { filter: { type: "has", value: "attachment" }, phrase: "attachments" },
  { filter: { type: "is", value: "read" }, phrase: "opened" },
  { filter: { type: "is", value: "read" }, phrase: "read" },
  { filter: { type: "is", value: "inbox" }, phrase: "inbox" },
  { filter: { type: "is", value: "archived" }, phrase: "archived" },
  { filter: { type: "is", value: "spam" }, phrase: "junk" },
  { filter: { type: "is", value: "spam" }, phrase: "spam" },
  { filter: { type: "is", value: "trash" }, phrase: "binned" },
  { filter: { type: "is", value: "trash" }, phrase: "deleted" },
  { filter: { type: "is", value: "trash" }, phrase: "trash" },
  { filter: { type: "is", value: "trash" }, phrase: "trashed" },
  { filter: { type: "is", value: "sent" }, phrase: "outbound" },
  { filter: { type: "is", value: "sent" }, phrase: "outgoing" },
  { filter: { type: "is", value: "sent" }, phrase: "sent" },
  { filter: { type: "is", value: "inbound" }, phrase: "incoming" },
  { filter: { type: "is", value: "inbound" }, phrase: "inbound" },
  { filter: { type: "is", value: "inbound" }, phrase: "received" },
];

const FIXED_FILTER_PHRASES = FIXED_FILTER_PHRASE_TABLE.toSorted(
  (left, right) => right.phrase.length - left.phrase.length
);

const CAPTURE_PREFIX_TYPES = new Map<string, MailSearchFilter["type"]>([
  ["bcc", "bcc"],
  ["cc", "cc"],
  ["from", "from"],
  ["sender", "from"],
  ["subject", "subject"],
  ["title", "subject"],
  ["titled", "subject"],
  ["to", "to"],
]);

const MONTHS_BY_NAME = new Map<string, number>([
  ["apr", 4],
  ["april", 4],
  ["aug", 8],
  ["august", 8],
  ["dec", 12],
  ["december", 12],
  ["feb", 2],
  ["february", 2],
  ["jan", 1],
  ["january", 1],
  ["jul", 7],
  ["july", 7],
  ["jun", 6],
  ["june", 6],
  ["mar", 3],
  ["march", 3],
  ["may", 5],
  ["nov", 11],
  ["november", 11],
  ["oct", 10],
  ["october", 10],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
]);

const NUMBER_WORDS = new Map<string, number>([
  ["eight", 8],
  ["five", 5],
  ["four", 4],
  ["nine", 9],
  ["one", 1],
  ["seven", 7],
  ["six", 6],
  ["ten", 10],
  ["three", 3],
  ["two", 2],
]);

type RelativeUnit = { days: null } | { days: number };

const RELATIVE_UNITS = new Map<string, RelativeUnit>([
  ["day", { days: 1 }],
  ["days", { days: 1 }],
  ["month", { days: null }],
  ["months", { days: null }],
  ["week", { days: 7 }],
  ["weeks", { days: 7 }],
  ["year", { days: null }],
  ["years", { days: null }],
]);

const DATE_BOUNDARY_WORDS = new Set([
  "after",
  "before",
  "last",
  "newer",
  "older",
  "past",
  "previous",
  "since",
  "this",
  "today",
  "until",
  "yesterday",
]);

type Token = { isConsumed: boolean; word: string };

const parseAmountWord = (word: string): number | null => {
  if (/^\d{1,4}$/u.test(word)) {
    return Number(word);
  }
  if (word === "a" || word === "an") {
    return 1;
  }
  return NUMBER_WORDS.get(word) ?? null;
};

const stripOrdinalSuffix = (value: string) =>
  value.replace(/(?:st|nd|rd|th)$/u, "");

const formatDateValue = (date: Date) =>
  `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const startOfWeek = (date: Date) => {
  const start = startOfDay(date);
  return addDays(start, -((start.getDay() + 6) % 7));
};

const serializeRelativeAmount = (amount: number, unit: "d" | "m" | "y") => {
  if (unit === "d") {
    return `${Math.min(3650, Math.max(1, amount))}d`;
  }
  if (unit === "m") {
    return `${Math.min(120, Math.max(1, amount))}m`;
  }
  return `${Math.min(50, Math.max(1, amount))}y`;
};

type TokenSliceMatch<T> = { length: number; value: T } | null;

const tryParseAmountUnitAt = (
  tokens: Token[],
  start: number
): TokenSliceMatch<{ amount: number; unit: "d" | "m" | "y" }> => {
  if (start + 1 >= tokens.length || tokens[start].isConsumed) {
    return null;
  }

  const amount = parseAmountWord(tokens[start].word);
  if (amount === null) {
    return null;
  }

  const unitToken = tokens[start + 1];
  if (unitToken.isConsumed) {
    return null;
  }
  const unitEntry = RELATIVE_UNITS.get(unitToken.word);
  if (!unitEntry) {
    return null;
  }

  return unitEntry.days === null
    ? {
        length: 2,
        value: { amount, unit: unitToken.word.startsWith("month") ? "m" : "y" },
      }
    : { length: 2, value: { amount: amount * unitEntry.days, unit: "d" } };
};

const tryParseAbsoluteDateAt = (
  tokens: Token[],
  start: number,
  now: Date
): TokenSliceMatch<Date> | null => {
  if (start >= tokens.length || tokens[start].isConsumed) {
    return null;
  }

  const isoMatch =
    /^(?<year>\d{4})[-/.](?<month>\d{1,2})[-/.](?<day>\d{1,2})$/u.exec(
      tokens[start].word
    );
  if (isoMatch?.groups) {
    const date = new Date(
      Number(isoMatch.groups.year),
      Number(isoMatch.groups.month) - 1,
      Number(isoMatch.groups.day)
    );
    return date.getTime() > 0 ? { length: 1, value: date } : null;
  }

  const resolveDate = (
    year: number | undefined,
    month: number,
    day: number
  ): { date: Date; length: number } | null => {
    const resolvedYear = year ?? now.getFullYear();
    const date = new Date(resolvedYear, month - 1, day);
    if (date.getDate() !== day || date.getMonth() !== month - 1) {
      return null;
    }
    const effectiveDate =
      year === undefined && date.getTime() > startOfDay(now).getTime()
        ? new Date(resolvedYear - 1, month - 1, day)
        : date;
    return {
      date: effectiveDate,
      length: year === undefined ? 2 : 3,
    };
  };

  const parseYearAt = (offset: number) => {
    const yearMatch = /^\d{4}$/u.exec(
      start + offset < tokens.length ? tokens[start + offset].word : ""
    );
    return yearMatch ? Number(yearMatch[0]) : undefined;
  };

  const monthBeforeDay = MONTHS_BY_NAME.get(tokens[start].word);
  if (monthBeforeDay !== undefined && start + 1 < tokens.length) {
    const dayValue = stripOrdinalSuffix(tokens[start + 1].word);
    const dayMatch = /^\d{1,2}$/u.exec(dayValue);
    if (dayMatch === null) {
      return null;
    }
    const resolved = resolveDate(
      parseYearAt(2),
      monthBeforeDay,
      Number(dayMatch[0])
    );
    return resolved ? { length: resolved.length, value: resolved.date } : null;
  }

  const dayWord = stripOrdinalSuffix(tokens[start].word);
  const dayMatch = /^\d{1,2}$/u.exec(dayWord);
  if (dayMatch === null || start + 1 >= tokens.length) {
    return null;
  }
  const monthAfterDay = MONTHS_BY_NAME.get(tokens[start + 1].word);
  if (monthAfterDay === undefined) {
    return null;
  }
  const resolved = resolveDate(
    parseYearAt(2),
    monthAfterDay,
    Number(dayMatch[0])
  );
  return resolved ? { length: resolved.length, value: resolved.date } : null;
};

type DateExpressionMatch = {
  filters: Omit<MailSearchFilter, "negated">[];
  length: number;
};

const tryParseDateExpressionAt = (
  tokens: Token[],
  start: number,
  now: Date
): DateExpressionMatch | null => {
  if (start >= tokens.length || tokens[start].isConsumed) {
    return null;
  }

  const wordAt = (offset: number) => tokens[start + offset]?.word;
  const matches = (offset: number, ...candidates: string[]) =>
    candidates.includes(wordAt(offset) ?? "");

  const relativeThanSpan = (
    filterType: "newer_than" | "older_than"
  ): DateExpressionMatch | null => {
    if (!matches(1, "than")) {
      return null;
    }
    const span = tryParseAmountUnitAt(tokens, start + 2);
    if (span === null) {
      return null;
    }
    return {
      filters: [
        {
          type: filterType,
          value: serializeRelativeAmount(span.value.amount, span.value.unit),
        },
      ],
      length: 2 + span.length,
    };
  };

  if (matches(0, "newer")) {
    return relativeThanSpan("newer_than");
  }

  if (matches(0, "older")) {
    return relativeThanSpan("older_than");
  }

  if (matches(0, "since", "before", "until", "after")) {
    const absolute = tryParseAbsoluteDateAt(tokens, start + 1, now);
    if (absolute) {
      return {
        filters: [
          {
            type: matches(0, "since", "after") ? "after" : "before",
            value: formatDateValue(absolute.value),
          },
        ],
        length: 1 + absolute.length,
      };
    }
    return null;
  }

  const rangePrefixOffset = (() => {
    let offset = 0;
    if (matches(offset, "in", "within", "over", "during")) {
      offset += 1;
    }
    if (matches(offset, "the")) {
      offset += 1;
    }
    return matches(offset, "last", "past", "previous") ? offset : null;
  })();

  if (rangePrefixOffset !== null) {
    const presetUnit = wordAt(rangePrefixOffset + 1);
    const presetDays = RELATIVE_UNITS.get(presetUnit ?? "");
    if (presetDays) {
      let presetValue = "365d";
      if (presetUnit?.startsWith("day")) {
        presetValue = "1d";
      } else if (presetUnit?.startsWith("week")) {
        presetValue = "7d";
      } else if (presetUnit?.startsWith("month")) {
        presetValue = "30d";
      }
      return {
        filters: [{ type: "newer_than", value: presetValue }],
        length: rangePrefixOffset + 2,
      };
    }

    const span = tryParseAmountUnitAt(tokens, start + rangePrefixOffset + 1);
    if (span) {
      return {
        filters: [
          {
            type: "newer_than",
            value: serializeRelativeAmount(span.value.amount, span.value.unit),
          },
        ],
        length: rangePrefixOffset + 1 + span.length,
      };
    }
  }

  if (matches(0, "this")) {
    const periodStart = (() => {
      if (matches(1, "week")) {
        return startOfWeek(now);
      }
      if (matches(1, "month")) {
        return new Date(now.getFullYear(), now.getMonth(), 1);
      }
      if (matches(1, "year")) {
        return new Date(now.getFullYear(), 0, 1);
      }
      return null;
    })();
    if (periodStart) {
      return {
        filters: [{ type: "after", value: formatDateValue(periodStart) }],
        length: 2,
      };
    }
  }

  if (matches(0, "today")) {
    return {
      filters: [{ type: "after", value: formatDateValue(startOfDay(now)) }],
      length: 1,
    };
  }

  if (matches(0, "yesterday")) {
    return {
      filters: [
        { type: "after", value: formatDateValue(addDays(startOfDay(now), -1)) },
        { type: "before", value: formatDateValue(startOfDay(now)) },
      ],
      length: 1,
    };
  }

  return null;
};

const matchFixedPhraseWithFillers = (
  tokens: Token[],
  start: number
): { endIndex: number; filter: Omit<MailSearchFilter, "negated"> } | null => {
  for (
    let index = start;
    index < Math.min(start + 4, tokens.length);
    index += 1
  ) {
    const token = tokens[index];
    if (token.isConsumed) {
      return null;
    }

    for (const entry of FIXED_FILTER_PHRASES) {
      const words = entry.phrase.split(" ");
      const end = index + words.length;
      if (end > tokens.length) {
        continue;
      }
      const matchesPhrase = words.every(
        (word, offset) =>
          !tokens[index + offset].isConsumed &&
          stripOrdinalSuffix(tokens[index + offset].word) === word
      );
      if (matchesPhrase) {
        return { endIndex: end, filter: entry.filter };
      }
    }

    if (!FILLER_WORDS.has(token.word)) {
      return null;
    }
  }
  return null;
};

const matchLabelWindowAt = (
  tokens: Token[],
  start: number,
  labels: ReadonlyMap<string, string>,
  maxLabelWords: number
): { length: number; name: string } | null => {
  for (
    let windowLength = Math.min(maxLabelWords, tokens.length - start);
    windowLength >= 1;
    windowLength -= 1
  ) {
    const candidate = tokens
      .slice(start, start + windowLength)
      .map((windowToken) => windowToken.word)
      .join(" ");
    const labelName = labels.get(candidate);
    if (labelName !== undefined) {
      return { length: windowLength, name: labelName };
    }
  }
  return null;
};

const findConstructAfterNegator = (
  tokens: Token[],
  start: number,
  labels: ReadonlyMap<string, string>,
  maxLabelWords: number
): number | null => {
  for (
    let index = start;
    index < Math.min(start + 4, tokens.length);
    index += 1
  ) {
    const token = tokens[index];
    if (token.isConsumed) {
      return null;
    }
    if (CAPTURE_PREFIX_TYPES.has(token.word)) {
      return index;
    }
    if (matchFixedPhraseWithFillers(tokens, index) !== null) {
      return index;
    }
    if (matchLabelWindowAt(tokens, index, labels, maxLabelWords) !== null) {
      return index;
    }
    if (!FILLER_WORDS.has(token.word)) {
      return null;
    }
  }
  return null;
};

const captureValueAfterPrefix = (
  tokens: Token[],
  prefixEnd: number
): { endIndex: number; words: string[] } => {
  const words: string[] = [];
  let endIndex = prefixEnd;

  while (
    endIndex < tokens.length &&
    words.length < 8 &&
    !tokens[endIndex].isConsumed
  ) {
    const token = tokens[endIndex];
    if (
      NEGATOR_WORDS.has(token.word) ||
      CAPTURE_PREFIX_TYPES.has(token.word) ||
      CAPTURE_STOP_WORDS.has(token.word) ||
      DATE_BOUNDARY_WORDS.has(token.word) ||
      matchFixedPhraseWithFillers(tokens, endIndex) !== null
    ) {
      break;
    }
    words.push(token.word);
    endIndex += 1;
  }

  while (words.length > 0 && FILLER_WORDS.has(words.at(-1) ?? "")) {
    words.pop();
    endIndex -= 1;
  }
  while (words.length > 0 && FILLER_WORDS.has(words[0])) {
    words.shift();
  }

  return { endIndex, words };
};

export const parseNaturalLanguageMailSearch = ({
  labels = [],
  now = new Date(),
  text,
}: {
  labels?: readonly string[];
  now?: Date;
  text: string;
}): NaturalLanguageMailSearchResult => {
  const normalizedLabels = new Map<string, string>();
  let maxLabelWords = 1;
  for (const label of labels) {
    const key = label.trim().toLocaleLowerCase().replaceAll(/\s+/gu, " ");
    if (key.length === 0) {
      continue;
    }
    normalizedLabels.set(key, label.trim());
    maxLabelWords = Math.max(maxLabelWords, key.split(" ").length);
  }

  const tokens: Token[] = normalizeSearchText(text)
    .toLocaleLowerCase()
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => ({ isConsumed: false, word }));

  const consumeRange = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      tokens[index].isConsumed = true;
    }
  };

  const filters: MailSearchFilter[] = [];
  const leftoverWords: string[] = [];
  let pendingNegation = false;

  let cursor = 0;
  while (cursor < tokens.length) {
    const token = tokens[cursor];
    if (token.isConsumed) {
      cursor += 1;
      continue;
    }

    const dateMatch = tryParseDateExpressionAt(tokens, cursor, now);
    if (dateMatch) {
      filters.push(...dateMatch.filters.map((filter) => ({ ...filter })));
      consumeRange(cursor, cursor + dateMatch.length);
      pendingNegation = false;
      cursor += dateMatch.length;
      continue;
    }

    const phraseMatch = matchFixedPhraseWithFillers(tokens, cursor);
    if (phraseMatch) {
      filters.push({
        ...phraseMatch.filter,
        ...(pendingNegation ? { negated: true } : {}),
      });
      consumeRange(cursor, phraseMatch.endIndex);
      pendingNegation = false;
      cursor = phraseMatch.endIndex;
      continue;
    }

    if (NEGATOR_WORDS.has(token.word)) {
      const targetIndex = findConstructAfterNegator(
        tokens,
        cursor + 1,
        normalizedLabels,
        maxLabelWords
      );
      if (targetIndex !== null) {
        consumeRange(cursor, targetIndex);
        pendingNegation = true;
        cursor = targetIndex;
        continue;
      }
    }

    const prefixType = CAPTURE_PREFIX_TYPES.get(token.word);
    if (prefixType) {
      const capture = captureValueAfterPrefix(tokens, cursor + 1);
      if (capture.words.length > 0) {
        filters.push({
          ...(pendingNegation ? { negated: true as const } : {}),
          type: prefixType,
          value: capture.words.join(" "),
        });
      }
      consumeRange(cursor, capture.endIndex);
      pendingNegation = false;
      cursor = Math.max(capture.endIndex, cursor + 1);
      continue;
    }

    const labelMatch = matchLabelWindowAt(
      tokens,
      cursor,
      normalizedLabels,
      maxLabelWords
    );
    if (labelMatch) {
      filters.push({
        ...(pendingNegation ? { negated: true } : {}),
        type: "label",
        value: labelMatch.name,
      });
      consumeRange(cursor, cursor + labelMatch.length);
      pendingNegation = false;
      cursor += labelMatch.length;
      continue;
    }

    if (pendingNegation) {
      pendingNegation = false;
    }
    if (!FILLER_WORDS.has(token.word) && !CAPTURE_STOP_WORDS.has(token.word)) {
      leftoverWords.push(token.word);
    }
    consumeRange(cursor, cursor + 1);
    cursor += 1;
  }

  const search = normalizeStructuredMailSearch({
    filters,
    text: normalizeSearchText(leftoverWords.join(" ")),
  });

  return search;
};
