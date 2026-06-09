import { describe, expect, test } from "bun:test";
import { buildMimeMessage } from "../src/compose/mime";

describe("buildMimeMessage", () => {
  test("adds managed sender headers and omits the Bcc header when requested", async () => {
    const sentAt = new Date("2026-06-07T10:00:00.000Z");
    const message = await buildMimeMessage(
      {
        attachments: [],
        bodyHtml: "<p>Hello</p>",
        bodyText: "Hello",
        errorMessage: null,
        inlineImages: [],
        localId: "local-message",
        recipients: {
          bcc: "hidden@example.com",
          cc: "",
          to: "recipient@example.com",
        },
        saveStatus: "idle",
        subject: "Managed message",
        updatedAt: sentAt.getTime(),
      },
      {
        from: "managed@quieter.email",
        messageId: "<message@quieter.email>",
        omitBccHeader: true,
        sentAt,
      },
    );

    expect(message).toContain("From: managed@quieter.email");
    expect(message).toContain("Message-ID: <message@quieter.email>");
    expect(message).toContain("Date: Sun, 07 Jun 2026 10:00:00 GMT");
    expect(message).not.toContain("Bcc:");
  });
});
