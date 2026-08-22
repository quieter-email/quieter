import type { OrganizationMailDeliveryStatus } from "@quieter/database/schema";
import { describe, expect, test } from "vite-plus/test";

import type { DeliveryStatePoint } from "../src/organization-mail-delivery";
import {
  getSuppressionReason,
  isTerminalDeliveryStatus,
  mergeDeliveryStatus,
} from "../src/organization-mail-delivery";

const at = (minutes: number) => new Date(Date.UTC(2026, 7, 14, 10, minutes, 0));

type TimelineEntry = {
  minutes: number;
  status: OrganizationMailDeliveryStatus;
};

const fold = (timeline: TimelineEntry[]) => {
  let state: DeliveryStatePoint | null = null;
  for (const entry of timeline) {
    state = mergeDeliveryStatus(state, {
      occurredAt: at(entry.minutes),
      status: entry.status,
    });
  }
  return state?.status ?? null;
};

describe(mergeDeliveryStatus, () => {
  test("adopts the first observed event", () => {
    expect(
      mergeDeliveryStatus(null, { occurredAt: at(5), status: "queued" }).status
    ).toBe("queued");
  });

  test("keeps terminal outcomes regardless of later event times", () => {
    expect(
      fold([
        { minutes: 1, status: "complained" },
        { minutes: 9, status: "delivered" },
      ])
    ).toBe("complained");
    expect(
      fold([
        { minutes: 2, status: "bounced" },
        { minutes: 9, status: "sent" },
      ])
    ).toBe("bounced");
    expect(
      fold([
        { minutes: 3, status: "rejected" },
        { minutes: 9, status: "delivered" },
      ])
    ).toBe("rejected");
    expect(
      fold([
        { minutes: 4, status: "unsubscribed" },
        { minutes: 9, status: "delivered" },
      ])
    ).toBe("unsubscribed");
  });

  test("a later complaint still overrides an earlier non-terminal state", () => {
    expect(
      fold([
        { minutes: 1, status: "delivered" },
        { minutes: 9, status: "complained" },
      ])
    ).toBe("complained");
    expect(
      fold([
        { minutes: 1, status: "delayed" },
        { minutes: 9, status: "bounced" },
      ])
    ).toBe("bounced");
  });

  test("follows the latest event time among non-terminal states", () => {
    expect(
      fold([
        { minutes: 1, status: "queued" },
        { minutes: 2, status: "sent" },
        { minutes: 3, status: "delivered" },
      ])
    ).toBe("delivered");
    expect(
      fold([
        { minutes: 1, status: "queued" },
        { minutes: 2, status: "sent" },
      ])
    ).toBe("sent");
  });

  test("an earlier late arrival does not regress a newer non-terminal state", () => {
    expect(
      fold([
        { minutes: 5, status: "opened" },
        { minutes: 3, status: "delivered" },
      ])
    ).toBe("opened");
    expect(
      fold([
        { minutes: 5, status: "delivered" },
        { minutes: 3, status: "delayed" },
      ])
    ).toBe("delivered");
  });

  test("duplicate events are absorbed without changing the outcome", () => {
    const timeline: TimelineEntry[] = [
      { minutes: 1, status: "sent" },
      { minutes: 2, status: "delivered" },
    ];
    const withDuplicates = [
      timeline[0],
      timeline[0],
      timeline[1],
      timeline[1],
      timeline[0],
    ];
    expect(fold(timeline)).toBe(fold(withDuplicates));
  });

  test("every permutation of a timeline converges on one outcome", () => {
    const timeline: TimelineEntry[] = [
      { minutes: 1, status: "queued" },
      { minutes: 2, status: "sent" },
      { minutes: 3, status: "delivered" },
      { minutes: 4, status: "bounced" },
      { minutes: 5, status: "complained" },
    ];
    const permutations = [
      [...timeline],
      [timeline[4], timeline[3], timeline[2], timeline[1], timeline[0]],
      [timeline[2], timeline[4], timeline[0], timeline[3], timeline[1]],
      [timeline[3], timeline[1], timeline[4], timeline[0], timeline[2]],
      [timeline[1], timeline[3], timeline[0], timeline[2], timeline[4]],
    ];
    const outcomes = permutations.map((permutation) => fold(permutation));
    expect(new Set(outcomes).size).toBe(1);
    expect(outcomes[0]).toBe("complained");
  });
});

describe(isTerminalDeliveryStatus, () => {
  test("marks failures and unsubscribes as terminal", () => {
    for (const status of [
      "bounced",
      "complained",
      "rejected",
      "unsubscribed",
    ] as const) {
      expect(isTerminalDeliveryStatus(status)).toBeTruthy();
    }
    for (const status of [
      "delayed",
      "delivered",
      "opened",
      "queued",
      "sent",
    ] as const) {
      expect(isTerminalDeliveryStatus(status)).toBeFalsy();
    }
  });
});

describe(getSuppressionReason, () => {
  test("maps complaints and unsubscribes to suppressions", () => {
    expect(getSuppressionReason({ eventType: "complained" })).toBe("complaint");
    expect(getSuppressionReason({ eventType: "unsubscribed" })).toBe(
      "unsubscribe"
    );
  });

  test("only permanent bounces suppress", () => {
    expect(
      getSuppressionReason({ eventType: "bounced", permanentFailure: true })
    ).toBe("bounce");
    expect(getSuppressionReason({ eventType: "bounced" })).toBeNull();
    expect(
      getSuppressionReason({ eventType: "bounced", permanentFailure: false })
    ).toBeNull();
  });

  test("leaves every other outcome unsuppressed", () => {
    for (const eventType of [
      "delayed",
      "delivered",
      "opened",
      "queued",
      "rejected",
      "sent",
    ] as const) {
      expect(getSuppressionReason({ eventType })).toBeNull();
    }
  });
});
