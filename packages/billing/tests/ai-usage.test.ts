import { describe, expect, test } from "bun:test";
import { AI_USAGE_MARKUP_BASIS_POINTS, applyAiUsageMarkup } from "../src";

describe("AI usage pricing", () => {
  test("adds a 50% margin to provider cost", () => {
    expect(AI_USAGE_MARKUP_BASIS_POINTS).toBe(5_000);
    expect(applyAiUsageMarkup(100)).toBe(150);
    expect(applyAiUsageMarkup(101)).toBe(152);
  });
});
