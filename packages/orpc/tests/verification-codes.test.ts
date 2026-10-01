import { describe, expect, test } from "vite-plus/test";

import {
  shouldInspectIncomingVerificationCode,
  validateVerificationCodeCandidate,
} from "../src/verification-codes/validation";

const now = new Date("2026-10-01T12:00:00.000Z");
const message = {
  bodyText: "Your login code is 482193. Use it to sign in.",
  id: "message-1",
  internalDate: String(now.getTime()),
  subject: "Sign in",
  threadId: "thread-1",
};

describe("AI verification code validation", () => {
  test("skips historical and outgoing mail before a model call", () => {
    expect(
      shouldInspectIncomingVerificationCode(
        {
          ...message,
          internalDate: String(now.getTime() - 3 * 60 * 60_000),
        },
        now
      )
    ).toBeFalsy();
    expect(
      shouldInspectIncomingVerificationCode(
        {
          ...message,
          labelIds: ["INBOX", "SENT"],
        },
        now
      )
    ).toBeFalsy();
    expect(shouldInspectIncomingVerificationCode(message, now)).toBeTruthy();
  });

  test("rejects codes the message does not contain", () => {
    expect(
      validateVerificationCodeCandidate({
        candidate: { code: "882193", expiresInSeconds: null, service: null },
        message,
        now,
      })
    ).toBeNull();
  });

  test("does not accept a short code embedded within another identifier", () => {
    expect(
      validateVerificationCodeCandidate({
        candidate: { code: "4821", expiresInSeconds: null, service: null },
        message,
        now,
      })
    ).toBeNull();
  });

  test("normalizes whitespace in a grounded grouped code", () => {
    expect(
      validateVerificationCodeCandidate({
        candidate: { code: "123 456", expiresInSeconds: null, service: null },
        message: { ...message, bodyText: "Your code is 123 456." },
        now,
      })
    ).toMatchObject({ code: "123456" });
  });

  test("grounds an HTML-only code split across adjacent inline elements", () => {
    expect(
      validateVerificationCodeCandidate({
        candidate: { code: "123 456", expiresInSeconds: null, service: null },
        message: {
          ...message,
          bodyHtml: "<p>Your code is <span>123</span><span>456</span>.</p>",
          bodyText: null,
        },
        now,
      })
    ).toMatchObject({ code: "123456" });
  });

  test("does not join unrelated numbers across HTML blocks or words", () => {
    for (const bodyHtml of [
      "<p>Reference 123</p><p>Order 456</p>",
      "<p>Reference 123 and 456</p>",
    ]) {
      expect(
        validateVerificationCodeCandidate({
          candidate: { code: "123456", expiresInSeconds: null, service: null },
          message: { ...message, bodyHtml, bodyText: null },
          now,
        })
      ).toBeNull();
    }
  });

  test("does not ground a code found only in HTML attributes or hidden content", () => {
    for (const bodyHtml of [
      '<a href="https://example.test/123456">Open account</a>',
      "<span hidden>123456</span><p>Open account</p>",
      '<span style="display:none">123456</span><p>Open account</p>',
      "<script>123456</script><p>Open account</p>",
      "<style>.code { content: '123456' }</style><p>Open account</p>",
    ]) {
      expect(
        validateVerificationCodeCandidate({
          candidate: { code: "123456", expiresInSeconds: null, service: null },
          message: { ...message, bodyHtml, bodyText: null },
          now,
        })
      ).toBeNull();
    }
  });

  test("keeps a grounded access code after its stated lifetime", () => {
    expect(
      validateVerificationCodeCandidate({
        candidate: { code: "482193", expiresInSeconds: 60, service: null },
        message: { ...message, internalDate: String(now.getTime() - 120_000) },
        now,
      })
    ).toMatchObject({ code: "482193" });
  });

  test("accepts a grounded, active temporary access code", () => {
    expect(
      validateVerificationCodeCandidate({
        candidate: {
          code: "482193",
          expiresInSeconds: 300,
          service: "  Account  ",
        },
        message,
        now,
      })
    ).toMatchObject({
      code: "482193",
      service: "Account",
    });
  });

  test("does not extend validity for a message dated in the future", () => {
    const result = validateVerificationCodeCandidate({
      candidate: {
        code: "482193",
        expiresInSeconds: 300,
        service: null,
      },
      message: {
        ...message,
        internalDate: String(now.getTime() + 24 * 60 * 60_000),
      },
      now,
    });
    expect(result?.expiresAt.getTime()).toBeLessThanOrEqual(
      now.getTime() + 300_000
    );
  });
});
