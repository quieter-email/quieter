import { describe, expect, test } from "bun:test";
import { isActiveBillingStatus } from "../src/entitlements";
import {
  BILLING_PRICE_CURRENCIES,
  BILLING_PRODUCTS,
  getBillingFixedPrices,
  productHasAi,
  productHasManagedMail,
} from "../src/plans";

describe("billing entitlement statuses", () => {
  test("grants access only after payment is active or trialing", () => {
    expect(isActiveBillingStatus("active")).toBe(true);
    expect(isActiveBillingStatus("trialing")).toBe(true);
    expect(isActiveBillingStatus("pending")).toBe(false);
    expect(isActiveBillingStatus("past_due")).toBe(false);
    expect(isActiveBillingStatus("canceled")).toBe(false);
    expect(isActiveBillingStatus("expired")).toBe(false);
  });
});

describe("billing products", () => {
  test("keeps personal and team credits separate", () => {
    expect(BILLING_PRODUCTS.personal.scope).toBe("personal");
    expect(BILLING_PRODUCTS.team.scope).toBe("team");
    expect(BILLING_PRODUCTS.team_ai.scope).toBe("team");
  });

  test("matches product access to the purchased capability", () => {
    expect(productHasAi("personal")).toBe(true);
    expect(productHasAi("team")).toBe(false);
    expect(productHasAi("team_ai")).toBe(true);
    expect(productHasManagedMail("personal")).toBe(false);
    expect(productHasManagedMail("team")).toBe(true);
    expect(productHasManagedMail("team_ai")).toBe(true);
  });

  test("turns every monthly payment into equal credits", () => {
    for (const product of Object.values(BILLING_PRODUCTS)) {
      expect(product.creditAmountCents).toBe(product.monthlyPriceCents);
    }
  });

  test("offers equal nominal prices in EUR and USD", () => {
    expect(BILLING_PRICE_CURRENCIES).toEqual(["eur", "usd"]);
    expect(getBillingFixedPrices("personal")).toEqual([
      { amountType: "fixed", priceAmount: 1_000, priceCurrency: "eur" },
      { amountType: "fixed", priceAmount: 1_000, priceCurrency: "usd" },
    ]);
    expect(getBillingFixedPrices("team_ai")).toEqual([
      { amountType: "fixed", priceAmount: 2_000, priceCurrency: "eur" },
      { amountType: "fixed", priceAmount: 2_000, priceCurrency: "usd" },
    ]);
  });
});
