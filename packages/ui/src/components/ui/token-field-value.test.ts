import { describe, expect, test } from "vite-plus/test";

import {
  applyTokenFieldToken,
  filterTokenFieldTokens,
  getTokenEndingAt,
  getTokenFieldQuery,
  parseTokenFieldSegments,
  serializeTokenFieldSegments,
} from "./token-field-value";
import type { TokenFieldToken } from "./token-field-value";

const linear: TokenFieldToken = {
  id: "linear",
  keywords: ["issues", "tickets"],
  label: "Linear",
  text: "@Linear",
};
const calendar: TokenFieldToken = {
  id: "google_calendar",
  label: "Google Calendar",
  text: "@Google Calendar",
};
const tokens = [linear, calendar];

describe(parseTokenFieldSegments, () => {
  test("splits a value into text and token runs", () => {
    expect(parseTokenFieldSegments("Use @Linear now", tokens)).toStrictEqual([
      { text: "Use ", type: "text" },
      { text: "@Linear", token: linear, type: "token" },
      { text: " now", type: "text" },
    ]);
  });

  test("does not tokenize a mention glued to more word characters", () => {
    expect(parseTokenFieldSegments("@Linearity", tokens)).toStrictEqual([
      { text: "@Linearity", type: "text" },
    ]);
  });

  test("tokenizes a mention followed by punctuation", () => {
    expect(parseTokenFieldSegments("ask @Linear.", tokens)).toStrictEqual([
      { text: "ask ", type: "text" },
      { text: "@Linear", token: linear, type: "token" },
      { text: ".", type: "text" },
    ]);
  });

  test("prefers the longest matching token", () => {
    const overlapping = [
      { id: "google", label: "Google", text: "@Google" },
      calendar,
    ];

    expect(
      parseTokenFieldSegments("@Google Calendar", overlapping)
    ).toStrictEqual([
      { text: "@Google Calendar", token: calendar, type: "token" },
    ]);
  });

  test("round-trips through serialization", () => {
    const value = "When a bug lands, use @Linear then @Google Calendar.";

    expect(
      serializeTokenFieldSegments(parseTokenFieldSegments(value, tokens))
    ).toBe(value);
  });
});

describe(getTokenFieldQuery, () => {
  test("finds the mention the caret sits inside", () => {
    expect(
      getTokenFieldQuery({ caret: 8, tokens, trigger: "@", value: "use @Lin" })
    ).toStrictEqual({ end: 8, query: "Lin", start: 4 });
  });

  test("ignores a trigger that already belongs to a token", () => {
    expect(
      getTokenFieldQuery({
        caret: 11,
        tokens,
        trigger: "@",
        value: "use @Linear",
      })
    ).toBeUndefined();
  });

  test("ignores a trigger inside a word, such as an email address", () => {
    expect(
      getTokenFieldQuery({
        caret: 15,
        tokens,
        trigger: "@",
        value: "mail@example.co",
      })
    ).toBeUndefined();
  });

  test("stops matching once the run grows past a plausible name", () => {
    expect(
      getTokenFieldQuery({
        caret: 45,
        tokens,
        trigger: "@",
        value: `@${"a".repeat(44)}`,
      })
    ).toBeUndefined();
  });
});

describe(filterTokenFieldTokens, () => {
  test("returns every token for an empty query", () => {
    expect(filterTokenFieldTokens(tokens, "")).toStrictEqual(tokens);
  });

  test("matches a label across its spaces", () => {
    expect(filterTokenFieldTokens(tokens, "googlecal")).toStrictEqual([
      calendar,
    ]);
  });

  test("matches keywords", () => {
    expect(filterTokenFieldTokens(tokens, "tickets")).toStrictEqual([linear]);
  });
});

describe(applyTokenFieldToken, () => {
  test("replaces the in-progress mention and adds a trailing space", () => {
    expect(
      applyTokenFieldToken({
        query: { end: 8, query: "Lin", start: 4 },
        token: linear,
        value: "use @Lin",
      })
    ).toStrictEqual({ caret: 12, value: "use @Linear " });
  });

  test("reuses the space that already follows the caret", () => {
    expect(
      applyTokenFieldToken({
        query: { end: 8, query: "Lin", start: 4 },
        token: linear,
        value: "use @Lin now",
      })
    ).toStrictEqual({ caret: 11, value: "use @Linear now" });
  });
});

describe(getTokenEndingAt, () => {
  test("finds a token the caret sits directly behind", () => {
    expect(
      getTokenEndingAt({ caret: 11, tokens, value: "use @Linear now" })
    ).toStrictEqual({ end: 11, start: 4 });
  });

  test("returns nothing when the caret is inside plain text", () => {
    expect(
      getTokenEndingAt({ caret: 3, tokens, value: "use @Linear now" })
    ).toBeUndefined();
  });
});
