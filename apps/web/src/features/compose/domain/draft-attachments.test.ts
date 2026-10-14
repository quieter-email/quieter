import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { rpc } from "#/lib/orpc";

import {
  addComposeAttachmentFiles,
  clearComposeDraftRuntimeFiles,
  createEmptyComposeDraft,
  saveComposeDraft,
  removeComposeRuntimeFile,
  sendComposeMessage,
} from "./draft";

const { getAttachment, saveDraft, sendMessage } = vi.hoisted(() => ({
  getAttachment: vi.fn<typeof rpc.mail.getAttachment>(),
  saveDraft: vi.fn<typeof rpc.mail.saveDraft>(),
  sendMessage: vi.fn<typeof rpc.mail.sendMessage>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the attachment RPC boundary is needed, without loading the server client.
vi.mock("#/lib/orpc", () => ({
  rpc: { mail: { getAttachment, saveDraft, sendMessage } },
}));

describe("compose attachments", () => {
  let draft = createEmptyComposeDraft();

  afterEach(() => {
    clearComposeDraftRuntimeFiles(draft);
    vi.resetAllMocks();
  });

  it("sends the selected file contents", async () => {
    draft = addComposeAttachmentFiles(createEmptyComposeDraft(), [
      new File(["attachment contents"], "notes.txt", { type: "text/plain" }),
    ]);
    await sendComposeMessage("mailbox-one", draft);
    const input = sendMessage.mock.calls[0]?.[0];
    expect(input?.mailboxId).toBe("mailbox-one");
    await expect(
      input?.message.attachments[0]?.file?.text()
    ).resolves.toContain("attachment contents");
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it("loads reopened attachments from their owning mailbox and message", async () => {
    draft = {
      ...createEmptyComposeDraft(),
      attachments: [
        {
          gmailAttachmentId: "saved-attachment",
          id: "saved-attachment",
          isInline: false,
          mimeType: "text/plain",
          name: "notes.txt",
          size: 4,
        },
      ],
      messageId: "saved-message",
    };
    getAttachment.mockResolvedValue({
      attachmentId: "saved-attachment",
      file: new File(["saved content"], "notes.txt"),
      size: 13,
    });
    saveDraft.mockResolvedValue({
      bodyHtml: "",
      bodyText: "",
      draftAnchor: null,
      draftId: "saved-draft",
      messageId: "saved-message",
      recipients: draft.recipients,
      replyContext: null,
      subject: "",
    });
    draft = await saveComposeDraft("mailbox-two", draft);
    getAttachment.mockRejectedValue(new Error("Attachment not found"));
    draft = await saveComposeDraft("mailbox-two", {
      ...draft,
      bodyText: "Edited again",
    });
    await sendComposeMessage("mailbox-two", draft);
    expect(getAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "saved-attachment",
        mailboxId: "mailbox-two",
        messageId: "saved-message",
      }),
      expect.anything()
    );
    const input = sendMessage.mock.calls[0]?.[0];
    await expect(
      input?.message.attachments[0]?.file?.text()
    ).resolves.toContain("saved content");
  });

  it("rejects oversized attachments before adding them", () => {
    draft = createEmptyComposeDraft();
    const file = new File(["large file"], "large.zip");
    Object.defineProperty(file, "size", { value: 1024 ** 3 });
    expect(() => addComposeAttachmentFiles(draft, [file])).toThrow(/limit/u);
    expect(draft.attachments).toHaveLength(0);
  });

  it("does not recache a file removed while its download is pending", async () => {
    const loading =
      Promise.withResolvers<
        Awaited<ReturnType<typeof rpc.mail.getAttachment>>
      >();
    draft = {
      ...createEmptyComposeDraft(),
      attachments: [
        {
          gmailAttachmentId: "attachment",
          id: "pending-attachment",
          isInline: false,
          mimeType: "text/plain",
          name: "notes.txt",
          size: 4,
        },
      ],
      messageId: "saved-message",
    };
    getAttachment.mockReturnValueOnce(loading.promise);
    const sending = sendComposeMessage("mailbox", draft);
    removeComposeRuntimeFile("pending-attachment");
    loading.resolve({
      attachmentId: "attachment",
      file: new File(["text"], "notes.txt"),
      size: 4,
    });
    await sending;
    getAttachment.mockRejectedValue(new Error("Attachment not found"));
    await expect(sendComposeMessage("mailbox", draft)).rejects.toThrow(
      /not found/u
    );
  });
});
