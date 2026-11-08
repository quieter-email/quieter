import { describe, expect, test } from "vite-plus/test";

import { sendMailInputSchema } from "../src/chat-tools";

describe("foreground chat tools", () => {
  test("requires an exact revision-bound payload for send", () => {
    expect(
      sendMailInputSchema.safeParse({
        draft: {
          attachments: [],
          bodyHtml: "<p>Updated</p>",
          draftId: "draft-1",
          draftRevision: 4,
          inlineImages: [],
          subject: "Updated",
          to: "person@example.test",
        },
      }).success
    ).toBeTruthy();
    expect(
      sendMailInputSchema.safeParse({
        draft: {
          attachments: [],
          bodyHtml: "<p>Missing revision</p>",
          draftId: "draft-1",
          inlineImages: [],
          subject: "Missing revision",
        },
      }).success
    ).toBeFalsy();
  });
});
