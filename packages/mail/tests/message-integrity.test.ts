import { describe, expect, test } from "vite-plus/test";

import {
  findInvalidMailAddresses,
  extractMailAddress,
} from "../src/compose/schema";
import {
  decodeMimeHeaderValue,
  decodePartBody,
  extractMessageAttachments,
  extractInlineMessageAttachments,
} from "../src/message-content";
import { parseStructuredSearchQuery } from "../src/search";
import { extractSenderEmail } from "../src/sender-avatar";

describe("message integrity", () => {
  test("preserves unrelated Unicode when a message resembles mojibake", () => {
    const text = "Ã© 漢字";
    expect(decodeMimeHeaderValue(text)).toBe(text);
    expect(
      decodePartBody({
        body: { data: Buffer.from(text).toString("base64url") },
      })
    ).toBe(text);
  });

  test("decodes MIME words without interpreting headers as HTML", () => {
    expect(decodeMimeHeaderValue("=?UTF-8?B?SGVsbG8gw6k=?=")).toBe("Hello é");
    expect(decodeMimeHeaderValue("a&amp;b@example.com")).toBe(
      "a&amp;b@example.com"
    );
    expect(decodeMimeHeaderValue("Family 👨‍👩‍👧")).toBe("Family 👨‍👩‍👧");
  });

  test("keeps unreferenced inline attachments available to download", () => {
    const payload = {
      parts: [
        {
          body: { attachmentId: "att", size: 3 },
          filename: "logo.png",
          headers: [
            { name: "Content-ID", value: "<logo>" },
            { name: "Content-Disposition", value: "inline" },
          ],
          mimeType: "image/png",
        },
      ],
    };
    expect(extractMessageAttachments(payload)).toStrictEqual([
      {
        attachmentId: "att",
        fileName: "logo.png",
        mimeType: "image/png",
        size: 3,
      },
    ]);
    expect(extractInlineMessageAttachments(payload)).toStrictEqual([]);
  });

  test("uses the sender mailbox rather than an address in the display name", () => {
    const sender = '"billing@trusted.example" <actual@sender.example>';
    expect(extractMailAddress(sender)).toBe("actual@sender.example");
    expect(extractSenderEmail(sender)).toBe("actual@sender.example");
  });

  test.each([
    "alice@example.com bob@example.com",
    "alice@example.com garbage",
    "Alice <alice@example.com> garbage",
  ])("rejects unparsed recipient text: %s", (entry) => {
    expect(findInvalidMailAddresses(entry)).toStrictEqual([entry]);
  });

  test("retains combined status filters", () => {
    expect(
      parseStructuredSearchQuery("is:unread -is:trash").filters
    ).toHaveLength(2);
  });
});
