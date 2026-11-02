import { describe, expect, it } from "vite-plus/test";

import { resolveCampaignDeliveryState } from "../../src/campaigns/delivery-state";

const eligibleAttempt = {
  attempts: 1,
  canceled: false,
  eligible: true,
  hasSendOperation: true,
  interrupted: false,
  recipientStatus: "sending" as const,
};

describe("campaign delivery recovery", () => {
  it("never retries a delivery whose provider acceptance is uncertain", () => {
    for (const operationStatus of [
      "pending",
      "submitting",
      "unknown",
    ] as const) {
      expect(
        resolveCampaignDeliveryState({ ...eligibleAttempt, operationStatus })
      ).toBe("uncertain");
    }
    expect(
      resolveCampaignDeliveryState({
        ...eligibleAttempt,
        interrupted: true,
        operationStatus: undefined,
      })
    ).toBe("uncertain");
    expect(
      resolveCampaignDeliveryState({
        ...eligibleAttempt,
        operationStatus: undefined,
        recipientStatus: "uncertain",
      })
    ).toBe("uncertain");
  });

  it("resumes a crash before any submission operation was linked", () => {
    expect(
      resolveCampaignDeliveryState({
        ...eligibleAttempt,
        hasSendOperation: false,
        interrupted: true,
        operationStatus: undefined,
      })
    ).toBe("pending");
    expect(
      resolveCampaignDeliveryState({
        ...eligibleAttempt,
        canceled: true,
        hasSendOperation: false,
        interrupted: true,
        operationStatus: undefined,
      })
    ).toBe("canceled");
  });

  it("recovers accepted deliveries even after cancel or unsubscribe", () => {
    for (const operationStatus of ["accepted", "completed"] as const) {
      expect(
        resolveCampaignDeliveryState({
          ...eligibleAttempt,
          canceled: true,
          eligible: false,
          operationStatus,
          recipientStatus: "uncertain",
        })
      ).toBe("sent");
    }
  });

  it("retries only known unsubmitted work and respects current eligibility", () => {
    for (const operationStatus of ["prepared", "rejected"] as const) {
      expect(
        resolveCampaignDeliveryState({
          ...eligibleAttempt,
          interrupted: true,
          operationStatus,
        })
      ).toBe("pending");
      expect(
        resolveCampaignDeliveryState({
          ...eligibleAttempt,
          canceled: true,
          operationStatus,
        })
      ).toBe("canceled");
      expect(
        resolveCampaignDeliveryState({
          ...eligibleAttempt,
          eligible: false,
          operationStatus,
        })
      ).toBe("excluded");
      expect(
        resolveCampaignDeliveryState({
          ...eligibleAttempt,
          attempts: 10,
          operationStatus,
        })
      ).toBe("failed");
    }
  });
});
