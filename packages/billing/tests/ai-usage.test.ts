import { describe, expect, test } from "vite-plus/test";
import { AI_USAGE_MARKUP_BASIS_POINTS, applyAiUsageMarkup } from "../src";
import { BILLING_USAGE_KINDS } from "../src/credits";

describe("AI usage pricing", () => {
  test("adds a 50% margin to provider cost", () => {
    expect(AI_USAGE_MARKUP_BASIS_POINTS).toBe(5_000);
    expect(applyAiUsageMarkup(100)).toBe(150);
    expect(applyAiUsageMarkup(101)).toBe(152);
  });

  test("tracks AI memory as a separate credit usage kind", () => {
    expect(BILLING_USAGE_KINDS).toContain("aiMemory");
  });
});
