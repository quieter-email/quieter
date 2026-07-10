import { describe, expect, test } from "vite-plus/test";
import { buildSendMimeMessage, sendMessageInputSchema } from "../src/send";

describe("sendMessageInputSchema", () => {
  test("accepts display-name senders and string recipients", () => {
    const result = sendMessageInputSchema.safeParse({
      from: "Demo <demo@example.com>",
      html: "<strong>Hello</strong>",
      subject: "Hello",
      text: "Hello",
      to: "to@example.com",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.to).toEqual(["to@example.com"]);
    }
  });

  test("rejects structural custom headers", () => {
    const result = sendMessageInputSchema.safeParse({
      from: "demo@example.com",
      headers: { Subject: "Injected" },
      subject: "Hello",
      text: "Hello",
      to: ["to@example.com"],
    });

    expect(result.success).toBe(false);
  });

  test("rejects malformed attachment content", () => {
    const result = sendMessageInputSchema.safeParse({
      attachments: [
        {
          content: "not base64!",
          filename: "demo.txt",
        },
      ],
      from: "demo@example.com",
      subject: "Hello",
      text: "Hello",
      to: ["to@example.com"],
    });

    expect(result.success).toBe(false);
  });

  test("rejects inline attachments without html", () => {
    const result = sendMessageInputSchema.safeParse({
      attachments: [
        {
          content: Buffer.from("hello").toString("base64"),
          disposition: "inline",
          filename: "hello.txt",
        },
      ],
      from: "demo@example.com",
      subject: "Hello",
      text: "Hello",
      to: ["to@example.com"],
    });

    expect(result.success).toBe(false);
  });
});

describe("buildSendMimeMessage", () => {
  test("builds raw MIME with display sender, omitted bcc header, custom headers, and attachments", () => {
    const built = buildSendMimeMessage(
      {
        attachments: [
          {
            content: Buffer.from("hello").toString("base64"),
            contentType: "text/plain",
            disposition: "attachment",
            filename: "hello.txt",
          },
        ],
        bcc: ["hidden@example.com"],
        from: "Demo <demo@example.com>",
        headers: [{ name: "X-Customer", value: "acme" }],
        html: "<strong>Hello</strong>",
        subject: "Hello",
        tags: [],
        text: "Hello",
        to: ["to@example.com"],
      },
      {
        messageId: "<message@example.com>",
        sentAt: new Date("2026-06-29T12:00:00.000Z"),
      },
    );

    expect(built.raw).toContain("From: Demo <demo@example.com>");
    expect(built.raw).toContain("Message-ID: <message@example.com>");
    expect(built.raw).toContain("X-Customer: acme");
    expect(built.raw).toContain('Content-Disposition: attachment; filename="hello.txt"');
    expect(built.raw).not.toContain("Bcc:");
    expect(built.attachmentSizeBytes).toBe(5);
    expect(built.to).toEqual(["to@example.com"]);
    expect(built.bcc).toEqual(["hidden@example.com"]);
  });

  test("folds long headers and wraps quoted-printable body lines", () => {
    const built = buildSendMimeMessage(
      {
        attachments: [],
        from: "demo@example.com",
        headers: [{ name: "X-Long", value: "x".repeat(160) }],
        subject: "Hello ".repeat(40),
        tags: [],
        text: "a".repeat(180),
        to: ["to@example.com"],
      },
      {
        messageId: "<message@example.com>",
        sentAt: new Date("2026-06-29T12:00:00.000Z"),
      },
    );

    expect(built.raw).toContain("\r\n ");
    for (const line of built.raw.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
  });
});
