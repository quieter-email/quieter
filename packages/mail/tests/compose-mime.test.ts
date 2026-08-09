import { describe, expect, test } from "vite-plus/test";

import { buildMimeMessage } from "../src/compose/mime";
import { composeDraftInputSchema } from "../src/compose/schema";

const draft = {
  attachments: [],
  bodyHtml: "<p>Hello</p>",
  bodyText: "Hello",
  errorMessage: null,
  inlineImages: [],
  localId: "local-message",
  recipients: {
    bcc: "",
    cc: "",
    to: "recipient@example.com",
  },
  saveStatus: "idle",
  subject: "Managed message",
  updatedAt: Date.now(),
};

describe(buildMimeMessage, () => {
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
      }
    );

    expect(message).toContain("From: managed@quieter.email");
    expect(message).toContain("Message-ID: <message@quieter.email>");
    expect(message).toContain("Date: Sun, 07 Jun 2026 10:00:00 GMT");
    expect(message).not.toContain("Bcc:");
  });

  test("rejects MIME-owned custom headers and folds long encoded headers", async () => {
    expect(
      composeDraftInputSchema.safeParse({
        ...draft,
        headers: [{ name: "sUbJeCt", value: "override" }],
      }).success
    ).toBeFalsy();
    expect(
      composeDraftInputSchema.safeParse({
        ...draft,
        headers: [{ name: "X-Long", value: "x".repeat(999) }],
      }).success
    ).toBeFalsy();

    const message = await buildMimeMessage({
      ...draft,
      headers: [{ name: "X-Long", value: "ü".repeat(80) }],
    });
    const headerSection = message.split("\r\n\r\n", 1)[0] ?? "";
    expect(headerSection).toContain("X-Long: =?UTF-8?B?");
    expect(headerSection).toContain("\r\n ");
    const lines = headerSection.split("\r\n");
    const customHeaderStart = lines.findIndex((line) =>
      line.startsWith("X-Long:")
    );
    const customHeaderLines = lines
      .slice(customHeaderStart)
      .filter((line) => line.startsWith(" ") || line.startsWith("X-Long:"));
    for (const line of customHeaderLines) {
      expect(line.length).toBeLessThanOrEqual(78);
    }
  });

  test("folds custom header values without splitting field names or UTF-8 characters", async () => {
    const longName = `X${"a".repeat(127)}`;
    const utf8Value = `${"a".repeat(35)}ü${"b".repeat(10)}`;
    const message = await buildMimeMessage({
      ...draft,
      headers: [
        { name: longName, value: "value" },
        { name: "X-UTF8", value: utf8Value },
      ],
    });
    const lines = (message.split("\r\n\r\n", 1)[0] ?? "").split("\r\n");
    const longNameIndex = lines.indexOf(`${longName}:`);
    expect(longNameIndex).toBeGreaterThanOrEqual(0);
    expect(lines[longNameIndex + 1]).toBe(" value");

    const utf8Index = lines.findIndex((line) => line.startsWith("X-UTF8:"));
    const encodedWords = lines
      .slice(utf8Index)
      .filter((line, index) => index === 0 || line.startsWith(" "))
      .join(" ")
      .match(/[=]\?UTF-8\?B\?(?<encoded>[^?]+)\?=/gu);
    expect(encodedWords).not.toBeNull();
    const decodedValue = (encodedWords ?? [])
      .map((word) => {
        const encoded =
          /[=]\?UTF-8\?B\?(?<encoded>[^?]+)\?=/u.exec(word)?.groups?.encoded ??
          "";
        return new TextDecoder().decode(
          Uint8Array.from(
            atob(encoded),
            (character) => character.codePointAt(0) ?? 0
          )
        );
      })
      .join("");
    expect(decodedValue).toBe(utf8Value);
  });

  test("sanitizes attachment MIME headers", async () => {
    const message = await buildMimeMessage({
      ...draft,
      attachments: [
        {
          file: new File(["content"], 'report"\r\nX-Injected: yes.txt'),
          id: "attachment",
          isInline: false,
          mimeType: "text/plain\r\nX-Injected: yes",
          name: 'report"\r\nX-Injected: yes.txt',
          size: 7,
        },
      ],
    });

    expect(message).toContain(
      'Content-Type: application/octet-stream; name="report___X-Injected: yes.txt"'
    );
    expect(message).toContain(
      'Content-Disposition: attachment; filename="report___X-Injected: yes.txt"'
    );
    expect(message).not.toContain("\r\nX-Injected: yes\r\n");
  });
});
