import PostalMime, { decodeWords } from "postal-mime";
import { describe, expect, test } from "vite-plus/test";

import { buildMimeMessage } from "../src/compose/mime";
import { composeDraftInputSchema } from "../src/compose/schema";

const draft = {
  attachments: [],
  bodyHtml: "<p>Hello</p>",
  bodyText: "Hello",
  inlineImages: [],
  localId: "local-message",
  recipients: {
    bcc: "hidden@example.com",
    cc: "",
    to: "recipient@example.com",
  },
  saveStatus: "idle",
  subject: "Managed message",
  updatedAt: 0,
};

describe(buildMimeMessage, () => {
  test("preserves sender metadata and omits Bcc when requested", async () => {
    const sentAt = new Date("2026-06-07T10:00:00.000Z");
    const parsed = await PostalMime.parse(
      await buildMimeMessage(draft, {
        from: "managed@quieter.email",
        messageId: "<message@quieter.email>",
        omitBccHeader: true,
        sentAt,
      })
    );
    expect(parsed.from?.address).toBe("managed@quieter.email");
    expect(parsed.messageId).toBe("<message@quieter.email>");
    expect(new Date(parsed.date ?? "")).toStrictEqual(sentAt);
    expect(parsed.bcc).toBeUndefined();
  });

  test("rejects structural and oversized custom headers", () => {
    for (const header of [
      { name: "sUbJeCt", value: "override" },
      { name: "X-Long", value: "x".repeat(999) },
    ]) {
      expect(
        composeDraftInputSchema.safeParse({ ...draft, headers: [header] })
          .success
      ).toBeFalsy();
    }
  });

  test("preserves custom header names and Unicode values", async () => {
    const headers = [
      { name: `X${"a".repeat(127)}`, value: "value" },
      { name: "X-UTF8", value: `${"a".repeat(35)}ü${"漢字".repeat(80)}` },
    ];
    const message = await buildMimeMessage({ ...draft, headers });
    const parsed = await PostalMime.parse(message);
    for (const header of headers) {
      expect(
        decodeWords(
          parsed.headers.find((item) => item.key === header.name.toLowerCase())
            ?.value ?? ""
        )
      ).toBe(header.value);
    }
    expect(
      message.split("\r\n").every((line) => Buffer.byteLength(line) <= 998)
    ).toBeTruthy();
  });

  test("rejects injected MIME types and prevents injected filename headers", async () => {
    const attachment = {
      file: new File(["content"], 'report"\r\nX-Injected: yes.txt'),
      id: "attachment",
      isInline: false,
      mimeType: "text/plain",
      name: 'report"\r\nX-Injected: yes.txt',
      size: 7,
    };
    expect(
      composeDraftInputSchema.safeParse({
        ...draft,
        attachments: [
          { ...attachment, mimeType: "text/plain\r\nX-Injected: yes" },
        ],
      }).success
    ).toBeFalsy();
    const message = await buildMimeMessage({
      ...draft,
      attachments: [attachment],
    });
    expect(message).not.toContain("\r\nX-Injected:");
    const parsed = await PostalMime.parse(message, {
      attachmentEncoding: "utf8",
    });
    expect(parsed.attachments[0]?.content).toBe("content");
  });
});
