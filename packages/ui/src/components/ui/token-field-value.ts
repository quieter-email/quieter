import type { PillTone } from "./pill";

/**
 * A mention the field can recognise. `text` is the exact plain-text spelling
 * that is stored and sent to the agent, so a token round-trips through the
 * value without any structured encoding.
 */
export type TokenFieldToken = {
  description?: string;
  iconClassName?: string;
  iconSrc?: string;
  id: string;
  keywords?: string[];
  label: string;
  text: string;
  tone?: PillTone;
};

export type TokenFieldSegment =
  | { text: string; token: TokenFieldToken; type: "token" }
  | { text: string; type: "text" };

export type TokenFieldQuery = {
  end: number;
  query: string;
  start: number;
};

const QUERY_MAX_LENGTH = 32;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

const isWordCharacter = (character: string | undefined) =>
  character !== undefined && WORD_CHARACTER.test(character);

const normalizeTerm = (term: string) =>
  term.toLowerCase().replaceAll(/[\s@_-]+/gu, "");

const matchesAt = (value: string, index: number, token: TokenFieldToken) =>
  value.startsWith(token.text, index) &&
  !isWordCharacter(value[index - 1]) &&
  !isWordCharacter(value[index + token.text.length]);

/**
 * Splits a value into text and token runs. Longer tokens win so that a token
 * whose text is a prefix of another one cannot shadow it.
 */
export const parseTokenFieldSegments = (
  value: string,
  tokens: TokenFieldToken[]
): TokenFieldSegment[] => {
  const ordered = tokens.toSorted((a, b) => b.text.length - a.text.length);
  const segments: TokenFieldSegment[] = [];
  let pending = "";
  let index = 0;

  while (index < value.length) {
    const at = index;
    const token = ordered.find((candidate) => matchesAt(value, at, candidate));

    if (token === undefined) {
      pending += value[index];
      index += 1;
      continue;
    }

    if (pending !== "") {
      segments.push({ text: pending, type: "text" });
      pending = "";
    }
    segments.push({ text: token.text, token, type: "token" });
    index += token.text.length;
  }

  if (pending !== "") {
    segments.push({ text: pending, type: "text" });
  }

  return segments;
};

export const serializeTokenFieldSegments = (segments: TokenFieldSegment[]) =>
  segments.map((segment) => segment.text).join("");

const getTokenRanges = (segments: TokenFieldSegment[]) => {
  const ranges: { end: number; start: number }[] = [];
  let cursor = 0;

  for (const segment of segments) {
    const end = cursor + segment.text.length;
    if (segment.type === "token") {
      ranges.push({ end, start: cursor });
    }
    cursor = end;
  }

  return ranges;
};

/**
 * Finds the in-progress mention the caret sits inside, if any. A trigger that
 * already belongs to a completed token is ignored so the list does not reopen
 * right after one is inserted.
 */
export const getTokenFieldQuery = ({
  caret,
  tokens,
  trigger,
  value,
}: {
  caret: number;
  tokens: TokenFieldToken[];
  trigger: string;
  value: string;
}): TokenFieldQuery | undefined => {
  const before = value.slice(0, caret);
  const start = before.lastIndexOf(trigger);

  if (start === -1 || isWordCharacter(before[start - 1])) {
    return undefined;
  }

  const query = before.slice(start + trigger.length);

  if (query.length > QUERY_MAX_LENGTH || query.includes("\n")) {
    return undefined;
  }

  const covered = getTokenRanges(parseTokenFieldSegments(value, tokens)).some(
    (range) => start >= range.start && start < range.end
  );

  return covered ? undefined : { end: caret, query, start };
};

export const filterTokenFieldTokens = (
  tokens: TokenFieldToken[],
  query: string
) => {
  const normalized = normalizeTerm(query);

  if (normalized === "") {
    return tokens;
  }

  return tokens.filter((token) =>
    [token.label, token.text, ...(token.keywords ?? [])].some((term) =>
      normalizeTerm(term).includes(normalized)
    )
  );
};

/**
 * Replaces the in-progress mention with the token, keeping exactly one space
 * after it so the next word does not merge into the token text.
 */
export const applyTokenFieldToken = ({
  query,
  token,
  value,
}: {
  query: TokenFieldQuery;
  token: TokenFieldToken;
  value: string;
}) => {
  const suffix = value.slice(query.end);
  const inserted = suffix.startsWith(" ") ? token.text : `${token.text} `;

  return {
    caret: query.start + inserted.length,
    value: `${value.slice(0, query.start)}${inserted}${suffix}`,
  };
};

/**
 * Returns the range of the token that ends exactly at the caret, so backspace
 * can remove a whole mention instead of clipping its last character.
 */
export const getTokenEndingAt = ({
  caret,
  tokens,
  value,
}: {
  caret: number;
  tokens: TokenFieldToken[];
  value: string;
}) =>
  getTokenRanges(parseTokenFieldSegments(value, tokens)).find(
    (range) => range.end === caret
  );
