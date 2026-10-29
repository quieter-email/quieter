import PostalMime from "postal-mime";
import { describe, expect, test } from "vite-plus/test";

import { assertRawMailSender } from "../src/raw-message";
import { sendMessageInputSchema } from "../src/send";
import { buildSendMimeMessage } from "../src/send-mime";

describe("send message input schema", () => {
  test.each([
    "victim@victim.example ( <sender@attacker.example>",
    "Victim (comment) <sender@example.com>",
    "Team: sender@example.com;",
    "one@example.com, Two <two@example.com>",
    "Name <sender@example.com> trailing",
    '"Unclosed <sender@example.com>',
    "Name\r\n <sender@example.com>",
    "\r\nsender@example.com",
    "sender@example.com\r\n",
  ])("rejects ambiguous sender syntax %s", async (from) => {
    const message = {
      attachments: [],
      from,
      subject: "Hello",
      tags: [],
      text: "Hello",
      to: ["to@example.com"],
    };
    expect(sendMessageInputSchema.safeParse(message).success).toBeFalsy();
    await expect(buildSendMimeMessage(message)).rejects.toThrow(/sender/iu);
  });

  test.each([
    "sender@example.com",
    "Demo Team <Sender@Example.com>",
    '"Doe, Jane (team): sales;" <sender@example.com>',
    '"Jane \\"JJ\\" Doe" <sender@example.com>',
    "日本語 <sender@example.com>",
  ])(
    "keeps serialized sender equal to the canonical identity %s",
    async (from) => {
      const message = sendMessageInputSchema.parse({
        from,
        subject: "Hello",
        text: "Hello",
        to: "to@example.com",
      });
      const built = await buildSendMimeMessage(message);
      const parsed = await PostalMime.parse(built.raw);
      expect(parsed.from).toMatchObject({ address: built.fromAddress });
      expect(parsed.headers.filter(({ key }) => key === "from")).toHaveLength(
        1
      );
    }
  );

  test("accepts display-name senders and string recipients", () => {
    const result = sendMessageInputSchema.safeParse({
      from: "Demo <demo@example.com>",
      html: "<strong>Hello</strong>",
      subject: "Hello",
      text: "Hello",
      to: "to@example.com",
    });

    expect(result.success).toBeTruthy();
    expect(result.success ? result.data.to : []).toStrictEqual([
      "to@example.com",
    ]);
  });

  test("rejects structural custom headers", () => {
    const result = sendMessageInputSchema.safeParse({
      from: "demo@example.com",
      headers: { Subject: "Injected" },
      subject: "Hello",
      text: "Hello",
      to: ["to@example.com"],
    });

    expect(result.success).toBeFalsy();
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

    expect(result.success).toBeFalsy();
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

    expect(result.success).toBeFalsy();
  });
});

describe("build send MIME message", () => {
  test.each([
    "From: victim@victim.example\r\n",
    "From: sender@example.com\r\nFrom: victim@victim.example\r\n",
    "From: Team: sender@example.com;\r\n",
    "From: sender@example.com, victim@victim.example\r\n",
    "Sender: sender@example.com\r\n",
  ])(
    "blocks inconsistent raw sender headers before delivery %s",
    async (headers) => {
      await expect(
        assertRawMailSender(`${headers}\r\nHello`, "sender@example.com")
      ).rejects.toThrow(/sender/iu);
    }
  );

  test("builds raw MIME with display sender, omitted bcc header, custom headers, and attachments", async () => {
    const built = await buildSendMimeMessage(
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
      }
    );

    const parsed = await PostalMime.parse(built.raw, {
      attachmentEncoding: "utf8",
    });
    expect(parsed.attachments[0]?.filename).toBe("hello.txt");
    expect(parsed.attachments[0]?.content).toBe("hello");
    expect({
      attachmentSizeBytes: built.attachmentSizeBytes,
      bcc: built.bcc,
      hasBccHeader: built.raw.includes("Bcc:"),
      hasCustomerHeader: built.raw.includes("X-Customer: acme"),
      hasFrom: built.raw.includes("From: Demo <demo@example.com>"),
      hasMessageId: built.raw.includes("Message-ID: <message@example.com>"),
      to: built.to,
    }).toStrictEqual({
      attachmentSizeBytes: 5,
      bcc: ["hidden@example.com"],
      hasBccHeader: false,
      hasCustomerHeader: true,
      hasFrom: true,
      hasMessageId: true,
      to: ["to@example.com"],
    });
  });

  test("folds long headers and wraps quoted-printable body lines", async () => {
    const built = await buildSendMimeMessage(
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
      }
    );

    expect(built.raw).toContain("\r\n ");
    for (const line of built.raw.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
  });
});
