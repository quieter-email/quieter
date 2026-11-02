import { describe, expect, test } from "vite-plus/test";

import { parseMailSearchExpression } from "../src/search-expression";

describe("mail search expression validation", () => {
  test.each([
    "launch OR",
    "AND launch",
    "launch AND OR decision",
    "NOT",
    '"unclosed',
    '""',
    "()",
    "{}",
    "(launch}",
    "launch)",
    "from:",
    "from:(alice OR bob)",
    "unknown:value",
    "rfc822msgid:value",
    "has:unknown",
    'from:"alice"bob',
    'word"phrase"',
    "-%%%",
    `${"(".repeat(100)}launch${")".repeat(100)}`,
    `${"NOT ".repeat(100)}launch`,
    "word ".repeat(1000),
    "x".repeat(20_000),
  ])("rejects invalid or unbounded input %s", (query) => {
    expect(() => parseMailSearchExpression(query)).toThrow(SyntaxError);
  });

  test("preserves escaped quotes inside a phrase", () => {
    expect(parseMailSearchExpression('"she said \\"yes\\""')).toMatchObject({
      phrase: true,
      type: "text",
      value: 'she said "yes"',
    });
  });
});
