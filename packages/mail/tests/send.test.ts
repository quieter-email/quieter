import PostalMime from "postal-mime";
import { describe, expect, test } from "vite-plus/test";
import { ZodError } from "zod";

import {
  MAX_SEND_ATTACHMENTS,
  MAX_SEND_ATTACHMENT_METADATA_LENGTH,
  sendMessageInputSchema,
} from "../src/send";
import { buildSendMimeMessage } from "../src/send-mime";

const baseMessage = {
  attachments: [],
  from: "demo@example.com",
  subject: "Hello",
  tags: [],
  text: "Hello",
  to: ["to@example.com"],
};

const attachment = {
  content: "YQ==",
  contentType: "text/plain",
  disposition: "attachment" as const,
  filename: "hello.txt",
};

describe("attachment resource limits", () => {
  test("rejects excessive attachments before reading their content", async () => {
    let reads = 0;
    const attachments = Array.from(
      { length: MAX_SEND_ATTACHMENTS + 1 },
      () => ({
        ...attachment,
        get content() {
          reads += 1;
          return "YQ==";
        },
      })
    );
    expect(
      sendMessageInputSchema.safeParse({ ...baseMessage, attachments }).success
    ).toBeFalsy();
    await expect(
      buildSendMimeMessage({ ...baseMessage, attachments })
    ).rejects.toThrow(ZodError);
    expect(reads).toBe(0);
  });

  test.each(["filename", "contentType", "contentId"])(
    "rejects oversized %s before MIME reads content",
    async (field) => {
      let reads = 0;
      const attachments = [
        {
          ...attachment,
          [field]: "x".repeat(MAX_SEND_ATTACHMENT_METADATA_LENGTH + 1),
          get content() {
            reads += 1;
            return "YQ==";
          },
        },
      ];
      expect(
        sendMessageInputSchema.safeParse({ ...baseMessage, attachments })
          .success
      ).toBeFalsy();
      reads = 0;
      await expect(
        buildSendMimeMessage({ ...baseMessage, attachments })
      ).rejects.toThrow(ZodError);
      expect(reads).toBe(0);
    }
  );

  test("keeps permitted attachment sets and decoded byte accounting", async () => {
    const parsed = sendMessageInputSchema.parse({
      ...baseMessage,
      attachments: [
        attachment,
        ...Array.from({ length: MAX_SEND_ATTACHMENTS - 1 }, (_, index) => ({
          ...attachment,
          content: "Y Q ==\n",
          contentId: `image-${index}`,
          disposition: "inline",
        })),
      ],
      html: "<p>Hello</p>",
    });
    const built = await buildSendMimeMessage(parsed);
    expect(built.attachments).toHaveLength(parsed.attachments.length);
    expect(built.attachmentSizeBytes).toBe(parsed.attachments.length);
    expect(built.attachments.some((file) => file.inline)).toBeTruthy();
  });

  test("counts empty internal attachments without dropping ordinary empty files", async () => {
    const empty = { ...attachment, content: "" };
    await expect(
      buildSendMimeMessage({
        ...baseMessage,
        attachments: Array.from(
          { length: MAX_SEND_ATTACHMENTS + 1 },
          () => empty
        ),
      })
    ).rejects.toThrow(ZodError);
    const built = await buildSendMimeMessage({
      ...baseMessage,
      attachments: [empty],
    });
    expect(built.attachments).toHaveLength(1);
    expect(built.attachmentSizeBytes).toBe(0);
  });
});

describe("send message input schema", () => {
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
