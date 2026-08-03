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

  test("rejects MIME-owned custom headers and folds long encoded headers", async () => {
    expect(
      composeDraftInputSchema.safeParse({
        ...draft,
        headers: [{ name: "sUbJeCt", value: "override" }],
      }).success,
    ).toBe(false);
    expect(
      composeDraftInputSchema.safeParse({
        ...draft,
        headers: [{ name: "X-Long", value: "x".repeat(999) }],
      }).success,
    ).toBe(false);

    const message = await buildMimeMessage({
      ...draft,
      headers: [{ name: "X-Long", value: "ü".repeat(80) }],
    });
    const headerSection = message.split("\r\n\r\n", 1)[0] ?? "";
    expect(headerSection).toContain("X-Long: =?UTF-8?B?");
    expect(headerSection).toContain("\r\n ");
    const lines = headerSection.split("\r\n");
    const customHeaderStart = lines.findIndex((line) => line.startsWith("X-Long:"));
    const customHeaderLines = lines
      .slice(customHeaderStart)
      .filter((line) => line.startsWith(" ") || line.startsWith("X-Long:"));
    for (const line of customHeaderLines) {
      expect(line.length).toBeLessThanOrEqual(78);
    }
  });
});
