import type { GmailUsefulDetailCandidate } from "@quieter/ai";
import type { MessageListItem } from "@quieter/gmail";
import { describe, expect, test } from "bun:test";
import { materializeGmailUsefulDetail } from "../src/gmail-useful-details";

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
  expectedAt: null,
  kind: "none",
  merchant: null,
  service: null,
  status: null,
  summary: null,
  trackingNumber: null,
  ...input,
});

describe("Gmail useful-detail materialization", () => {
  test("keeps a fresh verification code for ten minutes from receipt", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        code: "123 456",
        kind: "verification_code",
        service: "Example",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail).toMatchObject({
      code: "123456",
      dedupeKey: "message:message-1",
      kind: "verification_code",
      title: "Example",
    });
    expect(detail?.expiresAt.toISOString()).toBe("2026-06-14T12:08:00.000Z");
  });

  test("drops verification codes that already expired", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        code: "123456",
        kind: "verification_code",
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
    expect(detail?.expiresAt.toISOString()).toBe("2026-06-18T18:00:00.000Z");
  });

  test("keeps delivered updates for two days", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({
        carrier: "Example Post",
        kind: "delivery",
        status: "delivered",
        trackingNumber: "AB1234",
      }),
      message: message(),
      now: NOW,
    });

    expect(detail?.expiresAt.toISOString()).toBe("2026-06-16T12:00:00.000Z");
  });

  test("drops empty delivery classifications", () => {
    const detail = materializeGmailUsefulDetail({
      candidate: candidate({ kind: "delivery" }),
      message: message(),
      now: NOW,
    });

    expect(detail).toBeNull();
  });
});
