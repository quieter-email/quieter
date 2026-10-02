import { buildMimeMessage } from "@quieter/mail/compose/mime";
import { composeDraftInputSchema } from "@quieter/mail/compose/schema";
import PostalMime from "postal-mime";
import { describe, expect, test } from "vite-plus/test";

import { sendMessageInputSchema } from "../src/send";
import { buildSendMimeMessage } from "../src/send-mime";

const subject = "漢字 📨 café ".repeat(30);
const text = `${"longword".repeat(200)}  \r\ntrailing tab\t\r\n漢字 📨`;
const filename = 'report "final" \\ 漢字.txt';
const payload = "attachment bytes 📨";

describe("MIME round trips", () => {
  test("preserves Unicode, long tokens, whitespace and filenames for API mail", async () => {
    const message = sendMessageInputSchema.parse({
      attachments: [
        { content: Buffer.from(payload).toString("base64"), filename },
      ],
      bcc: "hidden@example.com",
      from: '"漢字 📨" <sender@example.com>',
      subject,
      text,
      to: '"Résumé" <recipient@example.com>',
    });
    const built = await buildSendMimeMessage(message);
    const parsed = await PostalMime.parse(built.raw, {
      attachmentEncoding: "utf8",
    });
    expect(parsed.subject).toBe(subject.trim());
    expect(parsed.from).toMatchObject({
      address: "sender@example.com",
      name: "漢字 📨",
    });
    expect(parsed.to?.[0]).toMatchObject({
      address: "recipient@example.com",
      name: "Résumé",
    });
    expect(parsed.text?.replaceAll("\r\n", "\n").trimEnd()).toBe(
      text.replaceAll("\r\n", "\n")
    );
    expect(parsed.bcc).toBeUndefined();
    expect(parsed.attachments[0]?.filename).toBe(filename);
    expect(parsed.attachments[0]?.content).toBe(payload);
    expect(built.bcc).toStrictEqual(["hidden@example.com"]);
  });

  test("preserves compose draft metadata, Bcc and inline content while encoding headers", async () => {
    const draft = composeDraftInputSchema.parse({
      attachments: [],
      bodyHtml: '<p>Hello<img src="cid:logo@example.com"></p>',
      bodyText: text,
      draftAnchor: {
        seededBy: "reply",
        sourceMessageId: "source-message",
        sourceThreadId: "source-thread",
      },
      inlineImages: [
        {
          contentId: "logo@example.com",
          file: new File([payload], filename, { type: "image/png" }),
          id: "image",
          mimeType: "image/png",
          name: filename,
          size: payload.length,
        },
      ],
      localId: "draft",
      recipients: {
        bcc: "hidden@example.com",
        cc: "",
        to: "recipient@example.com",
      },
      saveStatus: "unsaved",
      subject,
      updatedAt: 0,
    });
    const raw = await buildMimeMessage(draft, {
      includeQuieterDraftHeaders: true,
    });
    const parsed = await PostalMime.parse(raw, { attachmentEncoding: "utf8" });
    expect(parsed.subject).toBe(subject);
    expect(parsed.bcc?.[0]).toMatchObject({ address: "hidden@example.com" });
    expect(parsed.headers).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "x-quieter-source-message-id",
          value: "source-message",
        }),
      ])
    );
    expect(parsed.attachments[0]).toMatchObject({
      contentId: "<logo@example.com>",
      filename,
    });
    expect(parsed.attachments[0]?.content).toBe(payload);
    const sent = await PostalMime.parse(
      await buildMimeMessage(draft, { omitBccHeader: true })
    );
    expect(sent.bcc).toBeUndefined();
    expect(
      sent.headers.some((header) => header.key.startsWith("x-quieter-"))
    ).toBeFalsy();
  });
});
