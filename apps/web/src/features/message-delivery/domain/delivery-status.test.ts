import { describe, expect, it } from "vite-plus/test";

import {
  ACCEPTED_DELIVERY_LABEL,
  getAggregateDeliveryLabel,
  getAggregateDeliveryStatus,
  getDeliveryActionGuidance,
  getDeliveryStatusTone,
  getRecipientDeliveryEvents,
  hasDeliveryDiagnostics,
  isDeliveryStatusUnsettled,
  summarizeDeliveryRecipients,
} from "./delivery-status";
import type {
  MessageDeliveryEvent,
  MessageDeliveryRecipient,
  MessageDeliveryStatus,
} from "./delivery-status";

const createRecipient = (
  recipient: string,
  status: MessageDeliveryStatus
): MessageDeliveryRecipient => ({
  lastEventAt: new Date("2026-08-14T10:00:00.000Z"),
  recipient,
  status,
});

const createEvent = (
  overrides: Partial<MessageDeliveryEvent> & { recipient: string }
): MessageDeliveryEvent => ({
  diagnosticCode: null,
  eventType: "delivered",
  occurredAt: new Date("2026-08-14T10:00:00.000Z"),
  providerStatus: null,
  reason: null,
  ...overrides,
});

describe(getAggregateDeliveryStatus, () => {
  it("reports no status when no recipient events exist", () => {
    expect(getAggregateDeliveryStatus([])).toBeNull();
    expect(getAggregateDeliveryLabel([])).toBe(ACCEPTED_DELIVERY_LABEL);
  });

  it("prefers a complaint over every other outcome", () => {
    expect(
      getAggregateDeliveryStatus([
        createRecipient("first@example.com", "delivered"),
        createRecipient("second@example.com", "bounced"),
        createRecipient("third@example.com", "complained"),
      ])
    ).toBe("complained");
  });

  it("prefers a bounce over a rejection, delay, or delivery", () => {
    expect(
      getAggregateDeliveryStatus([
        createRecipient("first@example.com", "delivered"),
        createRecipient("second@example.com", "delayed"),
        createRecipient("third@example.com", "rejected"),
        createRecipient("fourth@example.com", "bounced"),
      ])
    ).toBe("bounced");
  });

  it("does not label partial delivery as fully delivered", () => {
    expect(
      getAggregateDeliveryStatus([
        createRecipient("first@example.com", "delivered"),
        createRecipient("second@example.com", "queued"),
      ])
    ).toBe("queued");
  });

  it("prefers unresolved recipients over successful recipients", () => {
    expect(
      getAggregateDeliveryStatus([
        createRecipient("first@example.com", "sent"),
        createRecipient("second@example.com", "delivered"),
        createRecipient("third@example.com", "delayed"),
      ])
    ).toBe("delayed");
    expect(
      getAggregateDeliveryStatus([
        createRecipient("first@example.com", "sent"),
        createRecipient("second@example.com", "delivered"),
      ])
    ).toBe("sent");
  });

  it("labels a delivery without calling it read", () => {
    expect(
      getAggregateDeliveryLabel([
        createRecipient("first@example.com", "delivered"),
      ])
    ).toBe("Delivered");
    expect(
      getAggregateDeliveryLabel([
        createRecipient("first@example.com", "bounced"),
      ])
    ).toBe("Couldn't deliver");
  });
});

describe(getDeliveryStatusTone, () => {
  it("keeps unresolved states neutral", () => {
    expect(getDeliveryStatusTone(null)).toBe("neutral");
    expect(getDeliveryStatusTone("sent")).toBe("neutral");
    expect(getDeliveryStatusTone("queued")).toBe("neutral");
  });

  it("separates a delivery from a delay and a failure", () => {
    expect(getDeliveryStatusTone("delivered")).toBe("positive");
    expect(getDeliveryStatusTone("delayed")).toBe("warning");
  });

  it("marks every terminal failure as danger", () => {
    expect(getDeliveryStatusTone("bounced")).toBe("danger");
    expect(getDeliveryStatusTone("complained")).toBe("danger");
    expect(getDeliveryStatusTone("rejected")).toBe("danger");
  });
});

describe(isDeliveryStatusUnsettled, () => {
  it("treats missing events, sends, queues, and delays as still moving", () => {
    expect(isDeliveryStatusUnsettled(null)).toBeTruthy();
    expect(isDeliveryStatusUnsettled("sent")).toBeTruthy();
    expect(isDeliveryStatusUnsettled("queued")).toBeTruthy();
    expect(isDeliveryStatusUnsettled("delayed")).toBeTruthy();
    expect(isDeliveryStatusUnsettled("delivered")).toBeFalsy();
  });
});

describe(getRecipientDeliveryEvents, () => {
  it("keeps only the recipient's events, newest first", () => {
    const events = [
      createEvent({
        eventType: "sent",
        occurredAt: new Date("2026-08-14T10:00:00.000Z"),
        recipient: "first@example.com",
      }),
      createEvent({
        eventType: "delivered",
        occurredAt: new Date("2026-08-14T10:05:00.000Z"),
        recipient: "first@example.com",
      }),
      createEvent({
        eventType: "delivered",
        occurredAt: new Date("2026-08-14T10:06:00.000Z"),
        recipient: "second@example.com",
      }),
    ];

    expect(
      getRecipientDeliveryEvents(events, "first@example.com").map(
        (event) => event.eventType
      )
    ).toStrictEqual(["delivered", "sent"]);
  });
});

describe(hasDeliveryDiagnostics, () => {
  it("ignores blank diagnostic fields", () => {
    expect(
      hasDeliveryDiagnostics(createEvent({ recipient: "first@example.com" }))
    ).toBeFalsy();
    expect(
      hasDeliveryDiagnostics(
        createEvent({ reason: "   ", recipient: "first@example.com" })
      )
    ).toBeFalsy();
    expect(
      hasDeliveryDiagnostics(
        createEvent({
          diagnosticCode: "smtp; 550 5.1.1 unknown",
          recipient: "first@example.com",
        })
      )
    ).toBeTruthy();
  });
});

describe(getDeliveryActionGuidance, () => {
  it("tells the sender to correct a refused or bounced address", () => {
    expect(getDeliveryActionGuidance("rejected")).toMatch(/review/iu);
    expect(getDeliveryActionGuidance("bounced")).toMatch(/blocked/iu);
  });

  it("keeps complaints and unsubscribes distinct from folder placement", () => {
    const complained = getDeliveryActionGuidance("complained") ?? "";
    expect(complained).toMatch(/reported/iu);
    expect(complained).not.toMatch(/spam folder|junk folder/iu);
  });

  it("gives no instruction for healthy or in-flight states", () => {
    for (const status of ["delayed", "delivered", "queued", "sent"] as const) {
      expect(getDeliveryActionGuidance(status)).toBeNull();
    }
  });
});

describe(summarizeDeliveryRecipients, () => {
  it("names a single recipient and counts the rest", () => {
    expect(summarizeDeliveryRecipients([])).toBe("No recipient updates yet");
    expect(
      summarizeDeliveryRecipients([
        createRecipient("first@example.com", "sent"),
      ])
    ).toBe("first@example.com");
    expect(
      summarizeDeliveryRecipients([
        createRecipient("first@example.com", "sent"),
        createRecipient("second@example.com", "sent"),
      ])
    ).toBe("2 recipients");
  });
});
