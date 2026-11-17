import { ORPCError } from "@orpc/server";
import { composeMessageInputSchema } from "@quieter/mail/compose/schema";
import { describe, expect, test } from "vite-plus/test";

import {
  captureScheduledSendPayload,
  hashScheduledSendPayload,
  readScheduledCancellationAuthority,
  readScheduledSendPayload,
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

  test("retains AI authority and optional message data through stored send restoration", async () => {
    const original = message();
    const payload = await captureScheduledSendPayload(original);
    const binding = {
      actorUserId: "owner",
      mailboxId: "inbox",
      requestHash: hashScheduledSendPayload(payload),
      sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
    };
    const origin = {
      kind: "ai",
      mailboxId: "inbox",
      mode: "interactive",
      policyVersion: 4,
      userId: "owner",
    } as const;
    const envelope = {
      ...binding,
      formatVersion: 1,
      message: payload,
      origin,
      privateContext: false,
    };
    const serialized = JSON.stringify(envelope);
    const stored: unknown = JSON.parse(serialized);
    const captured = readScheduledSendPayload(stored, binding);
    expect(captured.origin).toMatchObject(origin);
    const restored = restoreScheduledSendPayload(captured.message, {
      localId: "detached",
      sendOperationId: binding.sendOperationId,
    });
    expect(restored).toMatchObject({
      draftAnchor: original.draftAnchor,
      followUpReminder: original.followUpReminder,
      headers: original.headers,
      replyContext: original.replyContext,
    });
    const expectedAttachment =
      await original.attachments[0]?.file?.arrayBuffer();
    await expect(
      restored.attachments[0]?.file?.arrayBuffer()
    ).resolves.toStrictEqual(expectedAttachment);
  });

  test("refuses malformed stamps and changed content or operation bindings without human fallback", async () => {
    const payload = await captureScheduledSendPayload(message());
    const binding = {
      actorUserId: "owner",
      mailboxId: "inbox",
      requestHash: hashScheduledSendPayload(payload),
      sendOperationId: "18cba911-a53c-4555-a8bd-c03394db8335",
    };
    const envelope = {
      privateContext: false,
      ...binding,
      formatVersion: 1,
      message: payload,
      origin: {
        kind: "ai",
        mailboxId: "inbox",
        mode: "interactive",
        policyVersion: 3,
        userId: "owner",
      },
    };
    const invalid: unknown[] = [
      { ...envelope, formatVersion: 2 },
      { ...envelope, privateContext: undefined },
      { ...envelope, privateContext: "unknown" },
      { ...payload, aiAuthority: { kind: "ai", policyVersion: 3 } },
      { ...envelope, origin: { ...envelope.origin, kind: "other" } },
      { ...envelope, origin: { ...envelope.origin, policyVersion: -1 } },
      { ...envelope, origin: { kind: "ai" } },
      { ...envelope, mailboxId: "other" },
      { ...envelope, actorUserId: "other" },
      { ...envelope, sendOperationId: "other" },
      { ...envelope, origin: { ...envelope.origin, mailboxId: "other" } },
      { ...envelope, origin: { ...envelope.origin, userId: "other" } },
      {
        ...envelope,
        message: { ...payload, bodyText: "Altered after capture" },
      },
    ];
    for (const stored of invalid) {
      expect(() => readScheduledSendPayload(stored, binding)).toThrow(
        ORPCError
      );
    }
    expect(() =>
      readScheduledSendPayload(envelope, { ...binding, mailboxId: "other" })
    ).toThrow(ORPCError);
    expect(() =>
      readScheduledSendPayload(envelope, {
        ...binding,
        requestHash: "different",
      })
    ).toThrow(ORPCError);
  });

  test("restores historical human snapshots without granting them an AI policy version", async () => {
    const payload = await captureScheduledSendPayload(message());
    const restored = readScheduledSendPayload(payload, {
      actorUserId: "owner",
      mailboxId: "inbox",
      requestHash: hashScheduledSendPayload(payload),
      sendOperationId: "66d69d46-952d-49c0-bd35-de7406bcf5cc",
    });
    expect(restored.origin.kind).toBe("human");
    expect(
      restoreScheduledSendPayload(restored.message, {
        localId: "recovery",
        sendOperationId: "66d69d46-952d-49c0-bd35-de7406bcf5cc",
      }).recipients
    ).toMatchObject(payload.recipients);
    expect(() =>
      readScheduledSendPayload(
        { ...payload, origin: { kind: "ai" } },
        {
          actorUserId: "owner",
          mailboxId: "inbox",
          requestHash: hashScheduledSendPayload(payload),
          sendOperationId: "66d69d46-952d-49c0-bd35-de7406bcf5cc",
        }
      )
    ).toThrow(ORPCError);
  });

  test("keeps cancellation authority and private context across background restoration", () => {
    const binding = { actorUserId: "owner", mailboxId: "inbox" };
    const origin = {
      kind: "ai",
      mailboxId: "inbox",
      mode: "interactive",
      policyVersion: 3,
      userId: "owner",
    } as const;
    for (const [originalPrivate, cancellationPrivate] of [
      [true, false],
      [false, true],
    ]) {
      const packet = readScheduledCancellationAuthority(
        { origin, privateContext: cancellationPrivate },
        binding,
        { format: "bound", privateContext: originalPrivate }
      );
      expect(packet).toMatchObject({ origin, privateContext: true });
    }
    expect(
      readScheduledCancellationAuthority(
        { origin: { kind: "human" }, privateContext: false },
        binding,
        { format: "bound", privateContext: true }
      )
    ).toMatchObject({ origin: { kind: "human" }, privateContext: false });
  });

  test("refuses missing, malformed or foreign cancellation packets on new snapshots", () => {
    const binding = { actorUserId: "owner", mailboxId: "inbox" };
    const origin = {
      kind: "ai",
      mailboxId: "inbox",
      mode: "interactive",
      policyVersion: 3,
      userId: "owner",
    };
    const invalid: unknown[] = [
      undefined,
      null,
      { origin },
      { origin, privateContext: "unknown" },
      { authority: origin, origin: { kind: "human" }, privateContext: false },
      { origin: { ...origin, userId: "other" }, privateContext: false },
      { origin: { ...origin, mailboxId: "other" }, privateContext: false },
      { origin: { ...origin, policyVersion: -1 }, privateContext: false },
    ];
    for (const value of invalid) {
      expect(() =>
        readScheduledCancellationAuthority(value, binding, {
          format: "bound",
          privateContext: false,
        })
      ).toThrow(ORPCError);
    }
    expect(
      readScheduledCancellationAuthority(null, binding, {
        format: "legacy",
        privateContext: false,
      })
    ).toMatchObject({ origin: { kind: "human" }, privateContext: false });
    expect(() =>
      readScheduledCancellationAuthority({ origin }, binding, {
        format: "legacy",
        privateContext: false,
      })
    ).toThrow(ORPCError);
  });
});
