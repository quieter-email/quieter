import { describe, expect, test } from "bun:test";
import { parseGmailPubSubNotification } from "../src/gmail-pubsub-ingress";

const encodeNotification = (notification: unknown) =>
  Buffer.from(JSON.stringify(notification)).toString("base64url");

describe("Gmail push notification parsing", () => {
  test("normalizes Gmail's numeric history id", () => {
    expect(
      parseGmailPubSubNotification(
        encodeNotification({
          emailAddress: "mailbox@example.com",
          historyId: 1234567890,
        }),
      ),
    ).toEqual({
      emailAddress: "mailbox@example.com",
      historyId: "1234567890",
    });
  });

  test("keeps string history ids for compatibility", () => {
    expect(
      parseGmailPubSubNotification(
        encodeNotification({
          emailAddress: "mailbox@example.com",
          historyId: "1234567890",
        }),
      ),
    ).toEqual({
      emailAddress: "mailbox@example.com",
      historyId: "1234567890",
    });
  });
});
