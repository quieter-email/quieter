import { describe, expect, test } from "vite-plus/test";
import { parseRawMailMessage } from "../src/raw-message";

describe("parseRawMailMessage", () => {
  test("parses envelope, thread, and body fields from RFC822 mail", async () => {
    const message = await parseRawMailMessage(
      [
        'From: "Sender Name" <sender@example.com>',
        "To: inbox@quieter.email",
        "Subject: Managed inbox",
        "Message-ID: <message-1@example.com>",
        "In-Reply-To: <message-0@example.com>",
        "References: <message-0@example.com>",
        "Date: Sun, 7 Jun 2026 10:00:00 +0000",
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        "The managed mailbox is connected.",
      ].join("\r\n"),
    );

    expect(message).toMatchObject({
      bodyText: "The managed mailbox is connected.",
      from: '"Sender Name" <sender@example.com>',
      inReplyTo: "<message-0@example.com>",
      messageHeaderId: "<message-1@example.com>",
      references: "<message-0@example.com>",
      snippet: "The managed mailbox is connected.",
      subject: "Managed inbox",
      to: "inbox@quieter.email",
    });
    expect(message.date?.toISOString()).toBe("2026-06-07T10:00:00.000Z");
  });
});
