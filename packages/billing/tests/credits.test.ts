import { describe, expect, test } from "bun:test";
import { createPolarCreditUsageEvent } from "../src/credits";

describe("billing credits", () => {
  test("reports total consumed credits to Polar while keeping overage metadata separate", () => {
    const event = createPolarCreditUsageEvent({
      account: {
        creditAmountCents: 1_000,
        currentPeriodEnd: new Date("2026-07-01T00:00:00.000Z"),
        currentPeriodStart: new Date("2026-06-01T00:00:00.000Z"),
        externalCustomerId: "organization:team-1",
        organizationId: "team-1",
        product: "managed",
      },
      billableCostMicroCents: 0,
      category: "mail",
      costMicroCents: 2_500_000,
      eventId: "event-1",
      metadata: {
        chatId: "",
        direction: "outbound",
      },
    });

    expect(event.externalCustomerId).toBe("organization:team-1");
    expect(event.externalId).toBe("credit-usage:event-1");
    expect(event.metadata.credits).toBe(2.5);
    expect(event.metadata.totalCostCents).toBe(2.5);
    expect(event.metadata.billableCostCents).toBe(0);
    expect("chatId" in event.metadata).toBe(false);
  });
});
