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

  test("rejects an access code whose stated lifetime has elapsed", () => {
    expect(
      validateVerificationCodeCandidate({
        candidate: { code: "482193", expiresInSeconds: 60, service: null },
        message: { ...message, internalDate: String(now.getTime() - 120_000) },
        now,
      })
    ).toBeNull();
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
