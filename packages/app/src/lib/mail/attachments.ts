import type { MessageAttachment } from "@quieter/app/lib/mail";
import { rpc } from "@quieter/app/lib/orpc";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";

export const MESSAGE_ATTACHMENT_DRAG_TYPE = "application/x-quieter-attachment";

type DraggedMessageAttachment = {
  attachment: MessageAttachment;
  mailboxId: string;
  messageId: string;
  token: string;
};

let draggedAttachment: DraggedMessageAttachment | null = null;

export const startMessageAttachmentDrag = (
  dataTransfer: DataTransfer,
  source: Omit<DraggedMessageAttachment, "token">
) => {
  const token = crypto.randomUUID();
  draggedAttachment = { ...source, token };
  dataTransfer.effectAllowed = "copy";
  dataTransfer.setData(MESSAGE_ATTACHMENT_DRAG_TYPE, token);
};

export const clearMessageAttachmentDrag = () => {
  draggedAttachment = null;
};

export const readMessageAttachmentDrop = (
  dataTransfer: DataTransfer,
  mailboxId: string | null
) => {
  const source = draggedAttachment;
  draggedAttachment = null;
  return source?.mailboxId === mailboxId &&
    source?.token === dataTransfer.getData(MESSAGE_ATTACHMENT_DRAG_TYPE)
    ? source
    : null;
};

export { openAttachmentPreview } from "./attachment-preview";

export const loadMessageAttachment = async ({
  attachment,
  mailboxId,
  messageId,
  signal,
}: {
  attachment: Pick<MessageAttachment, "attachmentId" | "fileName" | "mimeType">;
  mailboxId: string;
  messageId: string;
  signal?: AbortSignal;
}): Promise<File> => {
  if (isSandboxMailboxId(mailboxId)) {
    throw new Error("This attachment can't be downloaded here.");
  }

  const result = await rpc.mail.getAttachment(
    {
      attachmentId: attachment.attachmentId,
      fileName: attachment.fileName,
      mailboxId,
      messageId,
      mimeType: attachment.mimeType,
    },
    { signal }
  );
  return result.file;
};

export const downloadAttachmentFromServer = async (
  mailboxId: string,
  messageId: string,
  attachmentId: string,
  fileName: string,
  mimeType: string,
  signal?: AbortSignal
) => {
  const file = await loadMessageAttachment({
    attachment: { attachmentId, fileName, mimeType },
    mailboxId,
    messageId,
    signal,
  });
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");

  try {
    anchor.href = objectUrl;
    anchor.download = file.name;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }

  return file;
};
