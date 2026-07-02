import type { GmailUsefulDetailCandidate } from "@quieter/ai/extract-gmail-useful-detail";
import type { MessageListItem } from "@quieter/gmail";
import { describe, expect, test } from "bun:test";
import {
  buildGmailUsefulDetailPreferenceProfile,
  materializeGmailUsefulDetail,
  materializeGmailVerificationCode,
} from "../src/gmail-useful-details/service";

const NOW = new Date("2026-06-14T12:00:00.000Z");

const message = (input?: Partial<MessageListItem>): MessageListItem => ({
  id: "message-1",
  internalDate: String(NOW.getTime() - 1000 * 60 * 2),
  threadId: "thread-1",
  ...input,
});

const candidate = (input: Partial<GmailUsefulDetailCandidate>): GmailUsefulDetailCandidate => ({
  carrier: null,
  code: null,
  confidence: "high",
  eventAt: null,
  expectedAt: null,
  kind: "none",
  location: null,
  merchant: null,
  reference: null,
  relevanceSource: null,
  relevantFrom: null,
  relevantUntil: null,
  service: null,
  status: null,
  summary: null,
  trackingNumber: null,
  ...input,
});

describe("Gmail useful-detail materialization", () => {
  test("extracts verification codes without model classification", () => {
    const detail = materializeGmailVerificationCode({
      message: message({
        bodyText: "Use code 123 456 to verify your sign-in. This code expires soon.",
        from: "Example <login@example.com>",
        subject: "Your verification code",
      }),
      now: NOW,
    });

    expect(detail).toMatchObject({
      code: "123456",
      dedupeKey: "message:message-1",
      kind: "verification_code",
      title: "Example <login@example.com>",
    });
    expect(detail?.expiresAt.toISOString()).toBe("2026-06-14T12:28:00.000Z");
  });

  test("does not extract stale verification codes", () => {
    const detail = materializeGmailVerificationCode({
      message: message({
        bodyText: "Your one-time code is 123456.",
        internalDate: String(NOW.getTime() - 1000 * 60 * 31),
        subject: "Security code",
      }),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("does not treat unrelated numeric strings as verification codes", () => {
    const detail = materializeGmailVerificationCode({
      message: message({
        bodyText: "Your order number is 123456 and the total is 42.00.",
        subject: "Order confirmation",
      }),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("uses the model-selected verification-code window", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        code: "123 456",
        kind: "verification_code",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T11:58:00.000Z",
        relevantUntil: "2026-06-14T12:03:00.000Z",
        service: "Example",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail).toMatchObject({
      code: "123456",
      dedupeKey: "message:message-1",
      kind: "verification_code",
      relevanceSource: "inferred",
      title: "Example",
    });
    expect(detail?.expiresAt.toISOString()).toBe("2026-06-14T12:03:00.000Z");
  });

  test("drops verification codes whose proposed window already expired", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        code: "123456",
        kind: "verification_code",
        relevanceSource: "explicit",
        relevantFrom: "2026-06-14T11:49:00.000Z",
        relevantUntil: "2026-06-14T11:59:00.000Z",
        service: "Example",
      }),
      message: message({ internalDate: String(NOW.getTime() - 1000 * 60 * 11) }),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("rejects code-like values without a digit", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        code: "ABCDEF",
        kind: "verification_code",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T11:58:00.000Z",
        relevantUntil: "2026-06-14T12:03:00.000Z",
        service: "Example",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("deduplicates delivery updates by normalized carrier and tracking number", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        carrier: "Example Post",
        expectedAt: "2026-06-16T18:00:00.000Z",
        kind: "delivery",
        merchant: "Example Store",
        relevanceSource: "explicit",
        relevantFrom: "2026-06-14T11:58:00.000Z",
        relevantUntil: "2026-06-16T20:00:00.000Z",
        status: "in_transit",
        summary: "Your parcel is moving through the network.",
        trackingNumber: "AB-12 34",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail).toMatchObject({
      dedupeKey: "tracking:AB1234",
      kind: "delivery",
      status: "in_transit",
      title: "Example Store",
      trackingNumber: "AB-12 34",
    });
    expect(detail?.expiresAt.toISOString()).toBe("2026-06-16T20:00:00.000Z");
  });

  test("uses a short model-selected window for delivered updates", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        carrier: "Example Post",
        kind: "delivery",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T11:58:00.000Z",
        relevantUntil: "2026-06-14T18:00:00.000Z",
        status: "delivered",
        trackingNumber: "AB1234",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail?.expiresAt.toISOString()).toBe("2026-06-14T18:00:00.000Z");
  });

  test("drops empty delivery classifications", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        kind: "delivery",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T11:58:00.000Z",
        relevantUntil: "2026-06-15T12:00:00.000Z",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("keeps a high-confidence appointment for its proposed visibility window", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        eventAt: "2026-06-20T09:00:00.000Z",
        kind: "appointment",
        location: "Main Street Clinic",
        reference: "APT-123",
        relevanceSource: "explicit",
        relevantFrom: "2026-06-19T09:00:00.000Z",
        relevantUntil: "2026-06-20T10:00:00.000Z",
        service: "Dentist appointment",
        summary: "Arrive 10 minutes early.",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail).toMatchObject({
      dedupeKey: "reference:APT123",
      kind: "appointment",
      location: "Main Street Clinic",
      title: "Dentist appointment",
    });
  });

  test("delays early appointment windows until the reminder window", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        eventAt: "2026-06-20T09:00:00.000Z",
        kind: "appointment",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T11:00:00.000Z",
        relevantUntil: "2026-06-20T10:00:00.000Z",
        summary: "Arrive 10 minutes early.",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail?.relevantFrom.toISOString()).toBe("2026-06-19T09:00:00.000Z");
  });

  test("does not show future reservations immediately after receipt", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        eventAt: "2026-07-25T18:30:00.000Z",
        kind: "reservation",
        location: "Zoo Palast Berlin",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T11:58:00.000Z",
        relevantUntil: "2026-07-25T20:30:00.000Z",
        service: "Zoo Palast Berlin",
        summary: "Die Odyssee-70mm is booked for July 25 at 20:30 at Zoo Palast Berlin.",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail).toMatchObject({
      kind: "reservation",
      location: "Zoo Palast Berlin",
      title: "Zoo Palast Berlin",
    });
    expect(detail?.relevantFrom.toISOString()).toBe("2026-07-24T18:30:00.000Z");
  });

  test("trims long summaries at a word boundary", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        eventAt: "2026-07-25T18:30:00.000Z",
        kind: "reservation",
        relevanceSource: "inferred",
        relevantFrom: "2026-07-24T18:30:00.000Z",
        relevantUntil: "2026-07-25T20:30:00.000Z",
        service: "Zoo Palast Berlin",
        summary:
          "Die Odyssee-70mm is booked for July 25 at 20:30 at Zoo Palast Berlin, with the booking confirmation and calendar entry available in the original message for reference.",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail?.summary?.endsWith("referen")).toBe(false);
    expect(detail?.summary?.endsWith("referenc")).toBe(false);
  });

  test("drops medium-confidence classifications", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        confidence: "medium",
        kind: "travel",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T12:00:00.000Z",
        relevantUntil: "2026-06-15T12:00:00.000Z",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("drops a category the mailbox preference profile avoids", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        eventAt: "2026-06-20T09:00:00.000Z",
        kind: "appointment",
        relevanceSource: "explicit",
        relevantFrom: "2026-06-19T09:00:00.000Z",
        relevantUntil: "2026-06-20T10:00:00.000Z",
        summary: "The appointment starts at 09:00.",
      }),
      message: message(),
      now: NOW,
      preferences: { avoidKinds: ["appointment"], preferKinds: [] },
    });

    expect(detail).toBeNull();
  });

  test.each([
    ["GitHub <notifications@github.com>", "task"],
    ["Sentry <alerts@sentry.io>", "security_alert"],
    ["CodeRabbit <notifications@coderabbit.ai>", "application"],
  ] as const)("drops automated engineering notifications from %s", (from, kind) => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        eventAt: "2026-06-15T09:00:00.000Z",
        kind,
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T12:00:00.000Z",
        relevantUntil: "2026-06-15T12:00:00.000Z",
        summary: "Review or investigate this automated notification.",
      }),
      message: message({ from }),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("drops tasks without an explicit deadline", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        kind: "task",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T12:00:00.000Z",
        relevantUntil: "2026-06-15T12:00:00.000Z",
        summary: "Review the document.",
      }),
      message: message({ from: "Person <person@example.com>" }),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("drops public voting reminders", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        eventAt: "2026-06-14T10:07:00.000Z",
        kind: "task",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T08:00:00.000Z",
        relevantUntil: "2026-06-14T11:07:00.000Z",
        service: "TU Berlin election",
        summary: "Vote for Liste 9 by 11:07.",
      }),
      message: message({
        from: "TU Berlin election <election@example.edu>",
        subject: "Vote for Liste 9 (Fridays for Future TU Berlin)",
      }),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("drops public job postings the user has not applied to", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        eventAt: "2026-06-20T21:59:00.000Z",
        kind: "application",
        relevanceSource: "explicit",
        relevantFrom: "2026-06-19T09:00:00.000Z",
        relevantUntil: "2026-06-20T22:30:00.000Z",
        service: "TU Berlin",
        summary: "Bewerbungsfrist for KI-Entwicklung roles is June 20.",
      }),
      message: message({
        from: "TU Berlin <jobs@example.edu>",
        subject: "Stellenausschreibung KI-Entwicklung und KI-Didaktik",
      }),
      now: NOW,
    });

    expect(detail).toBeNull();
  });

  test("keeps personal application deadlines", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        eventAt: "2026-06-20T21:59:00.000Z",
        kind: "application",
        reference: "APP-123",
        relevanceSource: "explicit",
        relevantFrom: "2026-06-19T09:00:00.000Z",
        relevantUntil: "2026-06-20T22:30:00.000Z",
        service: "TU Berlin",
        summary: "Your application APP-123 is missing documents due June 20.",
      }),
      message: message({
        from: "TU Berlin <admissions@example.edu>",
        subject: "Your application APP-123",
      }),
      now: NOW,
    });

    expect(detail).toMatchObject({
      dedupeKey: "reference:APP123",
      kind: "application",
    });
  });

  test("supports every conservative reminder category", () => {
    const kinds = [
      "application",
      "appointment",
      "bill",
      "document_expiry",
      "reservation",
      "return",
      "security_alert",
      "task",
      "travel",
    ] as const;

    for (const kind of kinds) {
      const detail = materializeGmailUsefulDetail({
        candidate: candidate({
          eventAt: "2026-06-15T09:00:00.000Z",
          kind,
          relevanceSource: "inferred",
          relevantFrom: "2026-06-14T12:00:00.000Z",
          relevantUntil: "2026-06-15T12:00:00.000Z",
          summary: `Useful ${kind} update`,
        }),
        message: message(),
        now: NOW,
      });

      expect(detail?.kind).toBe(kind);
    }
  });

  test("drops windows beyond the category safety horizon", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        kind: "security_alert",
        relevanceSource: "inferred",
        relevantFrom: "2026-06-14T12:00:00.000Z",
        relevantUntil: "2026-07-14T12:00:00.000Z",
        summary: "A new device signed in.",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail).toBeNull();
  });
});

describe("Gmail useful-detail preference profile", () => {
  test("applies one sender-specific rejection immediately", () => {
    const profile = buildGmailUsefulDetailPreferenceProfile({
      global: [],
      source: [{ count: 1, kind: "task", signal: "not_useful" }],
    });

    expect(profile).toEqual({ avoidKinds: ["task"], preferKinds: [] });
  });

  test("requires repeated global feedback before suppressing a category", () => {
    expect(
      buildGmailUsefulDetailPreferenceProfile({
        global: [{ count: 2, kind: "appointment", signal: "not_useful" }],
        source: [],
      }),
    ).toEqual({ avoidKinds: [], preferKinds: [] });
    expect(
      buildGmailUsefulDetailPreferenceProfile({
        global: [{ count: 3, kind: "appointment", signal: "not_useful" }],
        source: [],
      }),
    ).toEqual({ avoidKinds: ["appointment"], preferKinds: [] });
  });

  test("lets sender-specific positive feedback override a global rejection", () => {
    const profile = buildGmailUsefulDetailPreferenceProfile({
      global: [{ count: 4, kind: "delivery", signal: "not_useful" }],
      source: [{ count: 2, kind: "delivery", signal: "useful" }],
    });

    expect(profile).toEqual({ avoidKinds: [], preferKinds: ["delivery"] });
  });
});
