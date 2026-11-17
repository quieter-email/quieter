import { describe, expect, test } from "vite-plus/test";

import {
  composeDraftInputSchema,
  composeMessageEnvelopeSchema,
  composeMessageInputSchema,
  composeSendDraftInputSchema,
  getUnresolvedSnippetFields,
} from "../src/compose/schema";
import { createScheduledSendSchema } from "../src/scheduled-send";

const draft = {
  attachments: [],
  bodyHtml: "<p>Ready</p>",
  bodyText: "Ready",
  inlineImages: [],
  localId: "snippet-draft",
  recipients: { bcc: "", cc: "", to: "reader@example.test" },
  saveStatus: "idle",
  subject: "Review",
  updatedAt: 0,
};
const schedule = {
  mailboxId: "mailbox",
  sendAt: new Date(Date.now() + 60_000).toISOString(),
  timeZone: "UTC",
};

describe("snippet send admission", () => {
  test("public inputs preserve incomplete alternatives for authenticated contextual admission", () => {
    for (const content of [
      { bodyHtml: "<p>{{?<strong>project</strong>}}</p>", bodyText: "Ready" },
      { bodyHtml: "<p>Ready</p>", bodyText: "{{@unknown.context}}" },
    ]) {
      const incomplete = { ...draft, ...content };
      expect(
        getUnresolvedSnippetFields(composeMessageInputSchema.parse(incomplete))
      ).not.toHaveLength(0);
      expect(
        composeDraftInputSchema.safeParse(incomplete).success
      ).toBeTruthy();
      expect(
        composeMessageInputSchema.safeParse(incomplete).success
      ).toBeTruthy();
      expect(
        composeSendDraftInputSchema.safeParse(incomplete).success
      ).toBeTruthy();
      expect(
        createScheduledSendSchema.safeParse({
          ...schedule,
          message: incomplete,
        }).success
      ).toBeTruthy();
      expect(
        composeMessageEnvelopeSchema.safeParse(incomplete).success
      ).toBeTruthy();
    }
    expect(
      composeMessageInputSchema.safeParse({
        ...draft,
        bodyHtml: "<p>Use {{name}} or \\{{?literal}} in the example.</p>",
        bodyText: "Use {{name}} or \\{{?literal}} in the example.",
      }).success
    ).toBeTruthy();
    expect(
      createScheduledSendSchema.safeParse({ ...schedule, message: draft })
        .success
    ).toBeTruthy();
  });

  test.each([
    { recipients: { bcc: "", cc: "", to: "" } },
    { recipients: { bcc: "", cc: "", to: "not-an-address" } },
    { recipients: { bcc: "", cc: "bad-copy", to: "reader@example.test" } },
    { headers: [{ name: "From", value: "other@example.test" }] },
    {
      headers: [{ name: "X-Trace", value: "trace\r\nBcc: other@example.test" }],
    },
    { senderName: "Sender\r\nBcc: other@example.test" },
    {
      attachments: [
        {
          id: "file",
          isInline: false,
          mimeType: "text/plain\r\nBcc: other@example.test",
          name: "note.txt",
          size: 1,
        },
      ],
    },
    {
      inlineImages: [
        {
          contentId: "image\r\nBcc: other@example.test",
          id: "image",
          mimeType: "image/png",
          name: "image.png",
          size: 1,
        },
      ],
    },
  ])(
    "retains complete public envelope validation before contextual admission %#",
    (invalid) => {
      const message = {
        ...draft,
        ...invalid,
        bodyHtml: "<p>{{?received}}</p>",
        bodyText: "{{?received}}",
      };
      for (const schema of [
        composeMessageEnvelopeSchema,
        composeMessageInputSchema,
        composeSendDraftInputSchema,
      ]) {
        expect(schema.safeParse(message).success).toBeFalsy();
      }
      expect(
        createScheduledSendSchema.safeParse({ ...schedule, message }).success
      ).toBeFalsy();
    }
  );
});
