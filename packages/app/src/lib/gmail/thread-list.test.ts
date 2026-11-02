import {
  buildThreadListEntries,
  getThreadLabelIds,
} from "@quieter/app/lib/gmail/thread-list";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { describe, expect, test } from "vite-plus/test";

const message = (id: string, labelIds: string[]): MessageListItem => ({
  from: "Alex <alex@example.com>",
  id,
  internalDate: id === "latest" ? "2000" : "1000",
  labelIds,
  subject: "A conversation",
  threadId: "thread-1",
});

describe("thread label aggregation", () => {
  test("combines labels from every message in a thread", () => {
    const entries = buildThreadListEntries([
      message("latest", ["INBOX", "latest-only"]),
      message("previous", ["INBOX", "previous-only"]),
    ]);

    expect(entries[0]?.threadLabelIds).toStrictEqual([
      "INBOX",
      "latest-only",
      "previous-only",
    ]);
  });

  test("prefers the server-provided thread label snapshot for an anchor message", () => {
    expect(
      getThreadLabelIds([
        {
          labelIds: ["latest-only"],
          threadLabelIds: ["latest-only", "previous-only"],
        },
      ])
    ).toStrictEqual(["latest-only", "previous-only"]);
  });
});

describe("thread attachment names", () => {
  const invoice = {
    attachmentId: "invoice",
    fileName: "invoice.pdf",
    mimeType: "application/pdf",
    size: 1200,
  };
  const notes = {
    attachmentId: "notes",
    fileName: "notes.txt",
    mimeType: "text/plain",
    size: 600,
  };

  test("collects attachment names from all loaded messages without a summary", () => {
    const [entry] = buildThreadListEntries([
      { ...message("latest", ["INBOX"]), attachments: [invoice] },
      { ...message("previous", ["INBOX"]), attachments: [notes] },
    ]);

    expect(entry?.attachmentNames).toContain("invoice.pdf");
    expect(entry?.attachmentNames).toContain("notes.txt");
    expect(entry?.attachmentCount).toBe(2);
  });

  test.each([0, 1])(
    "uses a complete thread summary on grouped message %i without double counting names",
    (summaryIndex) => {
      const loadedMessages = [
        { ...message("latest", ["INBOX"]), attachments: [invoice] },
        { ...message("previous", ["INBOX"]), attachments: [notes] },
      ].map((item, index) => ({
        ...item,
        threadAttachmentCount: index === summaryIndex ? 3 : undefined,
        threadAttachmentNames:
          index === summaryIndex
            ? ["invoice.pdf", "notes.txt", "earlier.pdf"]
            : undefined,
      }));
      const [entry] = buildThreadListEntries(loadedMessages);

      expect(entry?.attachmentNames).toContain("earlier.pdf");
      expect(entry?.attachmentNames).toHaveLength(3);
      expect(entry?.attachmentCount).toBe(3);
      expect(
        entry?.attachmentNames.filter((name) => name === "invoice.pdf")
      ).toHaveLength(1);
    }
  );

  test("trusts an empty complete summary over message attachment metadata", () => {
    const [entry] = buildThreadListEntries([
      { ...message("latest", ["INBOX"]), attachments: [invoice] },
      {
        ...message("previous", ["INBOX"]),
        threadAttachmentCount: 0,
        threadAttachmentNames: [],
      },
    ]);

    expect(entry?.attachmentNames).toHaveLength(0);
    expect(entry?.attachmentCount).toBe(0);
  });
});
