import { describe, expect, test } from "vite-plus/test";

import { getUnsubscribeKey } from "../src/unsubscribe";

describe("subscription identity", () => {
  test("canonical list identifiers share state across senders and distinguish a sender's lists", () => {
    const key = getUnsubscribeKey([
      { name: "List-ID", value: "Updates\r\n <Weekly.Example.COM>" },
      { name: "From", value: "One <one@example.com>" },
    ]);
    expect(key).toBe(
      getUnsubscribeKey([
        { name: "list-id", value: "Another name <weekly.example.com>" },
        { name: "From", value: "Two <two@example.com>" },
      ])
    );
    expect(key).not.toBe(
      getUnsubscribeKey([
        { name: "List-Id", value: "<daily.example.com>" },
        { name: "From", value: "One <one@example.com>" },
      ])
    );
  });

  test("sender fallback uses the complete validated address", () => {
    const first = getUnsubscribeKey([
      { name: "From", value: '"Example, One" <ONE@Example.com>' },
    ]);
    expect(first).toBe(
      getUnsubscribeKey([{ name: "From", value: "one@example.com" }])
    );
    expect(first).not.toBe(
      getUnsubscribeKey([{ name: "From", value: "two@example.com" }])
    );
    expect(
      getUnsubscribeKey([{ name: "From", value: "Example Company" }])
    ).toBeUndefined();
    expect(
      getUnsubscribeKey([
        { name: "From", value: "one@example.com, two@example.com" },
      ])
    ).toBeUndefined();
  });

  test("invalid or ambiguous list headers cannot broaden sender suppression", () => {
    const sender = { name: "From", value: "one@example.com" };
    const fallback = getUnsubscribeKey([sender]);
    for (const value of [
      "example.com",
      "<bad id.example.com>",
      "<one.example.com>, <two.example.com>",
      "<https://example.com/token>",
    ]) {
      expect(getUnsubscribeKey([{ name: "List-Id", value }, sender])).toBe(
        fallback
      );
    }
    expect(getUnsubscribeKey([sender, sender])).toBeUndefined();
    expect(
      getUnsubscribeKey([
        { name: "List-Id", value: "<one.example.com>" },
        { name: "List-Id", value: "<two.example.com>" },
        sender,
      ])
    ).toBe(fallback);
  });
});
