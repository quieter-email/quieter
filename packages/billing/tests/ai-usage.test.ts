import { describe, expect, test } from "vite-plus/test";
import {
  AI_COST_RECOVERY_BASIS_POINTS,
  applyAiCostRecoveryFee,
  convertProviderCostToCreditMicroCents,
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

  test("converts the provider's exact USD cost to euro credits before the fee", () => {
    expect(convertProviderCostToCreditMicroCents({ costUsd: 1, usdToEurRate: 0.92 })).toBe(
      105_800_000,
    );
  });
});
