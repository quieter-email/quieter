import { describe, expect, test } from "vite-plus/test";
import {
  AI_COST_RECOVERY_BASIS_POINTS,
  applyAiCostRecoveryFee,
  getAiUsageCostMicroCents,
} from "../src/ai-pricing";
import { BILLING_USAGE_KINDS } from "../src/credits";

describe("AI usage pricing", () => {
  test("adds a 15% cost-recovery fee to provider cost", () => {
    expect(AI_COST_RECOVERY_BASIS_POINTS).toBe(1_500);
    expect(applyAiCostRecoveryFee(100)).toBe(115);
    expect(applyAiCostRecoveryFee(101)).toBe(117);
  });

  test("tracks AI memory as a separate credit usage kind", () => {
    expect(BILLING_USAGE_KINDS).toContain("aiMemory");
  });

  test("records the provider's exact USD cost before the fee", () => {
    expect(getAiUsageCostMicroCents(1)).toBe(115_000_000);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])(
    "rejects invalid provider costs %#",
    (costUsd) => {
      expect(() => getAiUsageCostMicroCents(costUsd)).toThrow();
    },
  );
});
