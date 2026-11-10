import { composeMessageInputSchema } from "@quieter/mail/compose/schema";
import { describe, expect, test } from "vite-plus/test";

import {
  captureScheduledSendPayload,
  restoreScheduledSendPayload,
  scheduledSendPayloadSchema,
} from "../src/scheduled-send/payload";

const message = () =>
  composeMessageInputSchema.parse({
    attachments: [
      {
        file: new File([new Uint8Array([0, 128, 255, 42])], "notes.bin"),
        id: "attachment",
        isInline: false,
        mimeType: "application/octet-stream",
        name: "notes.bin",
        size: 4,
      },
    ],
    baseRevision: "old-revision",
    bodyHtml:
      '<p>Hello<img data-compose-inline-id="inline" src="blob:old-url"></p>',
    bodyText: "Hello",
    draftAnchor: {
      seededBy: "reply",
      sourceMessageId: "original",
      sourceThreadId: "thread",
    },
    draftId: "old-draft",
    followUpReminder: {
      condition: "No reply",
      dueAt: "2030-01-02T12:00:00Z",
      requestId: "861ba0bf-0069-410d-9ced-7881a5273464",
      timeZone: "Europe/Berlin",
      title: "Follow up",
    },
    headers: [{ name: "X-Custom", value: "retained" }],
    inlineImages: [
      {
        contentId: "inline@example.test",
        file: new File([new Uint8Array([255, 216, 0, 42])], "image.jpg"),
        id: "inline",
        mimeType: "image/jpeg",
        name: "image.jpg",
        size: 4,
      },
    ],
    localId: "source-local",
    messageId: "old-message",
    recipients: {
      bcc: "hidden@example.test",
      cc: "copy@example.test",
      to: "person@example.test",
    },
    replyContext: {
      messageHeaderId: "<original@example.test>",
      references: ["<earlier@example.test>"],
      threadId: "thread",
    },
    saveStatus: "saved",
    senderName: "Person",
    subject: "A reply",
    updatedAt: 100,
  });

describe("scheduled message snapshots", () => {
  test("keeps message metadata and binary files after JSON storage while detaching provider draft identity", async () => {
    const original = message();
    const stored = await captureScheduledSendPayload(original);
    const serialized = JSON.stringify(stored);
    const value: unknown = JSON.parse(serialized);
    const restored = restoreScheduledSendPayload(
      scheduledSendPayloadSchema.parse(value),
      {
        localId: "scheduled-copy",
        sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
      }
    );
    expect(restored).toMatchObject({
      draftAnchor: original.draftAnchor,
      draftId: null,
      followUpReminder: original.followUpReminder,
      headers: original.headers,
      recipients: original.recipients,
      replyContext: original.replyContext,
      senderName: original.senderName,
    });
    expect(restored.localId).not.toBe(original.localId);
    expect(restored.baseRevision).toBeUndefined();
    expect(restored.messageId).toBeNull();
    expect(restored.bodyHtml).toContain("cid:inline@example.test");
    const attachment = restored.attachments[0]?.file;
    const inline = restored.inlineImages[0]?.file;
    expect(attachment).toBeInstanceOf(File);
    expect(inline).toBeInstanceOf(File);
    if (attachment === undefined || inline === undefined) {
      throw new Error("Stored files were not restored.");
    }
    expect(new Uint8Array(await attachment.arrayBuffer())).toStrictEqual(
      new Uint8Array([0, 128, 255, 42])
    );
    expect(new Uint8Array(await inline.arrayBuffer())).toStrictEqual(
      new Uint8Array([255, 216, 0, 42])
    );
  });

  test("rejects a missing file instead of scheduling a message with a disappearing attachment", async () => {
    const original = message();
    original.attachments = original.attachments.map((asset) => ({
      ...asset,
      file: undefined,
    }));
    await expect(captureScheduledSendPayload(original)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
