import type { OrganizationMailDeliveryStatus } from "@quieter/database/schema";
import { describe, expect, test } from "vite-plus/test";

import {
  getSuppressionReason,
  isTerminalDeliveryStatus,
  mergeDeliveryStatus,
} from "../src/organization-mail-delivery";
import type { DeliveryStatePoint } from "../src/organization-mail-delivery";

const statuses: OrganizationMailDeliveryStatus[] = [
  "queued",
  "sent",
  "delayed",
  "delivered",
  "rejected",
  "bounced",
  "complained",
];

describe(mergeDeliveryStatus, () => {
  test("converges for every status pair, timestamp order and tie", () => {
    for (const first of statuses) {
      for (const second of statuses) {
        for (const secondTime of [0, 1000, 2000]) {
          const a = { occurredAt: new Date(1000), status: first };
          const b = { occurredAt: new Date(secondTime), status: second };
          expect(mergeDeliveryStatus(a, b)).toStrictEqual(
            mergeDeliveryStatus(b, a)
          );
          expect(
            mergeDeliveryStatus(mergeDeliveryStatus(a, b), a)
          ).toStrictEqual(mergeDeliveryStatus(a, b));
          expect(mergeDeliveryStatus(a, b).occurredAt.getTime()).toBe(
            Math.max(1000, secondTime)
          );
        }
      }
    }
  });

  test("is associative across all status triples", () => {
    for (const first of statuses) {
      for (const second of statuses) {
        for (const third of statuses) {
          const a = { occurredAt: new Date(3000), status: first };
          const b = { occurredAt: new Date(1000), status: second };
          const c = { occurredAt: new Date(2000), status: third };
          expect(
            mergeDeliveryStatus(mergeDeliveryStatus(a, b), c)
          ).toStrictEqual(mergeDeliveryStatus(a, mergeDeliveryStatus(b, c)));
        }
      }
    }
  });

  test("delivery cannot regress to a later send or delay, but a bounce escalates it", () => {
    let state: DeliveryStatePoint = {
      occurredAt: new Date(1000),
      status: "delivered",
    };
    state = mergeDeliveryStatus(state, {
      occurredAt: new Date(2000),
      status: "sent",
    });
    state = mergeDeliveryStatus(state, {
      occurredAt: new Date(3000),
      status: "delayed",
    });
    expect(state.status).toBe("delivered");
    expect(
      mergeDeliveryStatus(state, {
        occurredAt: new Date(500),
        status: "bounced",
      }).status
    ).toBe("bounced");
    expect(isTerminalDeliveryStatus("delivered")).toBeTruthy();
    expect(isTerminalDeliveryStatus("delayed")).toBeFalsy();
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
