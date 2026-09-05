import { describe, expect, test } from "vite-plus/test";

import { getBillingStatusMessage } from "./billing";
import type { UserBillingOverview } from "./billing";

const billing: UserBillingOverview["teams"][number] = {
  canManageBilling: true,
  creditAmountCents: 1000,
  currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
  currentPeriodStart: new Date("2026-09-01T00:00:00.000Z"),
  hasAccess: true,
  hasUnlimitedAccess: false,
  organizationId: "team-a",
  organizationName: "Team A",
  product: "managed",
  subscription: {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
    status: "active",
  },
  usage: null,
};

describe("billing lifecycle messages", () => {
  test("does not show an ended-subscription notice for a new or active team", () => {
    expect(getBillingStatusMessage(billing)).toBeNull();
    expect(
      getBillingStatusMessage({
        ...billing,
        hasAccess: false,
        subscription: null,
      })
    ).toBeNull();
  });

  test("shows the end date while a scheduled cancellation still has access", () => {
    expect(
      getBillingStatusMessage({
        ...billing,
        subscription: {
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date("2026-10-01T12:00:00.000Z"),
          status: "active",
        },
      })
    ).toContain("Sending and API access continue until then");
  });

  test("directs an unconfirmed renewal to billing instead of another checkout", () => {
    expect(getBillingStatusMessage({ ...billing, hasAccess: false })).toContain(
      "renewal has not been confirmed"
    );
  });

  test.each(["canceled", "expired"] as const)(
    "offers a new plan after the subscription is %s",
    (status) => {
      expect(
        getBillingStatusMessage({
          ...billing,
          hasAccess: false,
          subscription: {
            cancelAtPeriodEnd: false,
            currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
            status,
          },
        })
      ).toContain("Choose a plan to restore access");
    }
  );

  test("keeps a past-due subscription recoverable through billing", () => {
    expect(
      getBillingStatusMessage({
        ...billing,
        hasAccess: false,
        subscription: {
          cancelAtPeriodEnd: false,
          currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
          status: "past_due",
        },
      })
    ).toContain("Open Manage billing");
  });
});
