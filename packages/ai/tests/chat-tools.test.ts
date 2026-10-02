import { describe, expect, test } from "vite-plus/test";

import {
  foregroundComposeDraftSchema,
  getWorkspaceOutputSchema,
  navigateInputSchema,
  sendMailInputSchema,
  workspaceViewSchema,
} from "../src/chat-tools";

describe("foreground chat tools", () => {
  test("keeps the full reviewed draft in workspace output", () => {
    const parsed = getWorkspaceOutputSchema.parse({
      draft: {
        attachments: [
          {
            gmailAttachmentId: "attachment-1",
            id: "local-attachment-1",
            isInline: false,
            mimeType: "application/pdf",
            name: "brief.pdf",
            size: 2048,
          },
        ],
        bodyHtml: "<p>Thanks,<br><strong>Leander</strong></p>",
        bodyText: "Thanks,\nLeander",
        draftId: "local-draft",
        draftRevision: 3,
        inlineImages: [
          {
            contentId: "quieter-inline-image-1",
            id: "image-1",
            isInline: true,
            mimeType: "image/png",
            name: "chart.png",
            size: 1024,
          },
        ],
        replyContext: {
          references: ["<original@example.test>"],
          threadId: "thread-1",
        },
        subject: "Re: Project",
        to: "team@example.test",
      },
      generation: 7,
      mailboxId: "mailbox-1",
      view: "compose",
    });

    expect(parsed.draft).toStrictEqual(
      foregroundComposeDraftSchema.parse(parsed.draft)
    );
  });

  test("does not allow compose as a navigation destination", () => {
    expect(
      navigateInputSchema.safeParse({ view: "compose" }).success
    ).toBeFalsy();
    expect(workspaceViewSchema.parse("compose")).toBe("compose");
  });

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
