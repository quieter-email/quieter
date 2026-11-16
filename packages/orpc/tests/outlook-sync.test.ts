import type { OutlookMessage } from "@quieter/outlook/graph";
import { describe, expect, test } from "vite-plus/test";

import { createOutlookProjection } from "../src/outlook/projection";
import { mergeOutlookDeltaProjection } from "../src/outlook/sync";

const message: OutlookMessage = {
  body: { content: "Current body", contentType: "text" },
  categories: ["Customer"],
  changeKey: "opaque-current",
  conversationId: "conversation-one",
  id: "message-one",
  internetMessageHeaders: [
    { name: "List-Unsubscribe", value: "<mailto:leave@example.test>" },
  ],
  isDraft: false,
  isRead: false,
  parentFolderId: "inbox-one",
  receivedDateTime: "2026-11-16T15:00:00Z",
  subject: "Original subject",
};

const previous = createOutlookProjection({
  attachments: [
    {
      "@odata.type": "#microsoft.graph.fileAttachment",
      id: "attachment-one",
      name: "invoice.pdf",
      size: 100,
    },
  ],
  kind: "full",
  message,
});

describe("Outlook sparse delta merge", () => {
  test("retains authoritative body and attachment metadata only at the same opaque revision", () => {
    const merged = mergeOutlookDeltaProjection({
      patch: {
        categories: [],
        changeKey: message.changeKey,
        id: message.id,
        isRead: true,
      },
      previous,
    });
    expect(merged?.message).toMatchObject({
      body: { content: "Current body" },
      categories: [],
      isRead: true,
      subject: message.subject,
    });
    expect(merged?.attachments).toMatchObject([{ name: "invoice.pdf" }]);
    expect(merged?.kind).toBe("full");
  });

  test.each(["opaque-next", "0", "opaque-aaa"])(
    "requires current-resource verification for a different opaque revision %s",
    (changeKey) => {
      expect(
        mergeOutlookDeltaProjection({
          patch: {
            changeKey,
            id: message.id,
            isRead: true,
            parentFolderId: "old-folder",
          },
          previous,
        })
      ).toBeNull();
      expect(previous.message.parentFolderId).toBe("inbox-one");
      expect(previous.message.body?.content).toBe("Current body");
    }
  );

  test("requires an authoritative fetch for missing revision or incomplete new message metadata", () => {
    expect(
      mergeOutlookDeltaProjection({
        patch: { id: message.id, isRead: true },
        previous,
      })
    ).toBeNull();
    expect(
      mergeOutlookDeltaProjection({
        patch: { changeKey: "opaque-new", id: "new-message" },
        previous: null,
      })
    ).toBeNull();
  });

  test("rejects cross-message merges and ignores unsolicited delta bodies at an unchanged revision", () => {
    expect(() =>
      mergeOutlookDeltaProjection({
        patch: { changeKey: message.changeKey, id: "other-message" },
        previous,
      })
    ).toThrow(/mailbox request/u);
    const merged = mergeOutlookDeltaProjection({
      patch: {
        body: { content: "Unsolicited body", contentType: "text" },
        changeKey: message.changeKey,
        id: message.id,
      },
      previous,
    });
    expect(merged?.message.body?.content).toBe("Current body");
  });
});
