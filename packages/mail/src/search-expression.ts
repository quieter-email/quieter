import type { MailSearchFilter } from "./search";
import { parseStructuredSearchFilterToken } from "./search";

export type MailSearchExpression =
  | { type: "text"; value: string; phrase: boolean }
  | { type: "filter"; filter: MailSearchFilter }
  | {
      type: "and";
      left: MailSearchExpression;
      right: MailSearchExpression;
    }
  | {
      type: "or";
      left: MailSearchExpression;
      right: MailSearchExpression;
    }
  | { type: "not"; operand: MailSearchExpression };

type SearchToken =
  | { type: "leaf"; expression: MailSearchExpression }
  | { type: "(" | ")" | "{" | "}" | "AND" | "OR" | "NOT" };

export const parseMailSearchExpression = (
  query: string
): MailSearchExpression | null => {
  if (query.length > 8192) {
    throw new SyntaxError("This search is too long. Use fewer terms.");
  }
  const tokens: SearchToken[] = [];
  let cursor = 0;
  while (cursor < query.length) {
    const character = query[cursor];
    if (/\s/u.test(character)) {
      cursor += 1;
      continue;
    }
    if (tokens.length >= 256) {
      throw new SyntaxError("This search has too many terms. Use fewer terms.");
    }
    if (
      character === "(" ||
      character === ")" ||
      character === "{" ||
      character === "}"
    ) {
      tokens.push({ type: character });
      cursor += 1;
      continue;
    }
    if (character === "-") {
      tokens.push({ type: "NOT" });
      cursor += 1;
      continue;
    }
    const start = cursor;
    let quoted = false;
    while (cursor < query.length) {
      const next = query[cursor];
      if (next === '"') {
        quoted = !quoted;
      } else if (quoted && next === "\\") {
        cursor += 2;
        continue;
      } else if (!quoted && /[\s(){}]/u.test(next)) {
        break;
      }
      cursor += 1;
    }
    if (quoted) {
      throw new SyntaxError("Close the quoted phrase in this search.");
    }
    const token = query.slice(start, cursor);
    if (token === "AND" || token === "OR" || token === "NOT") {
      tokens.push({ type: token });
      continue;
    }
    if (
      /^[a-z_][a-z0-9_-]*:/iu.test(token) &&
      !/^[a-z][a-z0-9+.-]*:\/\//iu.test(token)
    ) {
      const filter = parseStructuredSearchFilterToken(token);
      if (!filter?.value) {
        throw new SyntaxError(
          "Use a supported search filter with a value. Group complete filters in parentheses."
        );
      }
      const rawValue = token.slice(token.indexOf(":") + 1);
      if (rawValue.includes('"') && !/^"(?:\\.|[^"\\])*"$/u.test(rawValue)) {
        throw new SyntaxError("Put quotes around the entire filter value.");
      }
      tokens.push({ expression: { filter, type: "filter" }, type: "leaf" });
      continue;
    }
    const phrase = token.startsWith('"');
    if (token.includes('"') && !/^"(?:\\.|[^"\\])*"$/u.test(token)) {
      throw new SyntaxError("Put quotes around the entire search phrase.");
    }
    const value = phrase
      ? token.slice(1, -1).replaceAll(/\\(?<character>.)/gu, "$<character>")
      : token;
    if (!/[\p{L}\p{N}]/u.test(value)) {
      throw new SyntaxError("Enter a word or phrase between the quotes.");
    }
    tokens.push({ expression: { phrase, type: "text", value }, type: "leaf" });
  }
  if (tokens.length === 0) {
    return null;
  }
  let index = 0;
  const parseOperand = (depth: number): MailSearchExpression => {
    if (depth > 32) {
      throw new SyntaxError("This search has too many nested groups.");
    }
    const token = tokens[index];
    index += 1;
    if (token?.type === "leaf") {
      return token.expression;
    }
    if (token?.type === "NOT") {
      return { operand: parseOperand(depth + 1), type: "not" };
    }
    if (token?.type === "(" || token?.type === "{") {
      // oxlint-disable-next-line no-use-before-define
      const expression = parseOr(depth + 1, token.type === "{");
      if (tokens[index]?.type !== (token.type === "(" ? ")" : "}")) {
        throw new SyntaxError(
          "Close each search group with its matching bracket."
        );
      }
      index += 1;
      return expression;
    }
    throw new SyntaxError(
      "Enter a search term after each operator and inside each group."
    );
  };
  const parseAnd = (depth: number, anyOf: boolean): MailSearchExpression => {
    let expression = parseOperand(depth);
    while (index < tokens.length) {
      const next = tokens[index].type;
      if (
        next === "OR" ||
        next === ")" ||
        next === "}" ||
        (anyOf && next !== "AND")
      ) {
        break;
      }
      if (next === "AND") {
        index += 1;
      }
      expression = {
        left: expression,
        right: parseOperand(depth),
        type: "and",
      };
    }
    return expression;
  };
  const parseOr = (depth: number, anyOf: boolean): MailSearchExpression => {
    let expression = parseAnd(depth, anyOf);
    while (index < tokens.length) {
      const next = tokens[index].type;
      if (next === ")" || next === "}" || (!anyOf && next !== "OR")) {
        break;
      }
      if (next === "OR") {
        index += 1;
      }
      expression = {
        left: expression,
        right: parseAnd(depth, anyOf),
        type: "or",
      };
    }
    return expression;
  };
  const expression = parseOr(0, false);
  if (index !== tokens.length) {
    throw new SyntaxError(
      "Remove the unmatched closing bracket from this search."
    );
  }
  return expression;
};
