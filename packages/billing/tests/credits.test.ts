import { describe, expect, test } from "vite-plus/test";

import { createPolarCreditUsageEvent } from "../src/credits";

describe("billing credits", () => {
  test("reports total consumed credits to Polar while keeping overage metadata separate", () => {
    const event = createPolarCreditUsageEvent({
      account: {
        externalCustomerId: "organization:team-1",
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

    expect(event).toMatchObject({
      externalCustomerId: "organization:team-1",
      externalId: "credit-usage:event-1",
      metadata: {
        billableCostCents: 0,
        credits: 2.5,
        totalCostCents: 2.5,
      },
    });
    expect("chatId" in event.metadata).toBeFalsy();
  });
});
