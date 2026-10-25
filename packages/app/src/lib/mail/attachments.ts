import type { MessageAttachment } from "@quieter/app/lib/mail";
import { rpc } from "@quieter/app/lib/orpc";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";

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
