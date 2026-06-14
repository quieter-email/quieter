import { describe, expect, test } from "bun:test";
import { createGmailLiveSyncToken, verifyGmailLiveSyncToken } from "../src/gmail-live-sync-token";

const SECRET = "test-secret-that-is-long-enough-for-hmac";
const NOW = new Date("2026-06-14T12:00:00.000Z");

describe("Gmail live-sync tokens", () => {
  test("round trips a short-lived mailbox credential", () => {
    const credential = createGmailLiveSyncToken(
      { mailboxId: "mailbox_1", userId: "user_1" },
      SECRET,
      NOW,
    );

    expect(verifyGmailLiveSyncToken(credential.token, SECRET, NOW)).toMatchObject({
      mailboxId: "mailbox_1",
      userId: "user_1",
      version: 1,
    });
    expect(credential.expiresAt).toEqual(new Date("2026-06-14T12:01:30.000Z"));
  });

  test("rejects tampering", () => {
    const credential = createGmailLiveSyncToken(
      { mailboxId: "mailbox_1", userId: "user_1" },
      SECRET,
      NOW,
    );

    expect(() => verifyGmailLiveSyncToken(`${credential.token}x`, SECRET, NOW)).toThrow();
  });

  test("rejects expired credentials", () => {
    const credential = createGmailLiveSyncToken(
      { mailboxId: "mailbox_1", userId: "user_1" },
      SECRET,
      NOW,
    );

    expect(() =>
      verifyGmailLiveSyncToken(credential.token, SECRET, new Date("2026-06-14T12:01:31.000Z")),
    ).toThrow("expired");
  });
});
