import { isSandboxMailboxId } from "~/lib/gmail/demo-mail";
import { rpc } from "~/lib/orpc";

const loadAttachmentFromServer = async (
  mailboxId: string,
  messageId: string,
  attachmentId: string,
  fileName: string,
  mimeType: string,
  signal?: AbortSignal,
) => {
  const attachment = await rpc.mail.getAttachment(
    { attachmentId, fileName, mailboxId, messageId, mimeType },
    { signal },
  );
  return attachment.file;
};

export const downloadAttachmentFromServer = async (
  mailboxId: string,
  messageId: string,
  attachmentId: string,
  fileName: string,
  mimeType: string,
  signal?: AbortSignal,
) => {
  if (isSandboxMailboxId(mailboxId)) {
    throw new Error("This attachment can't be downloaded here.");
  }

  const file = await loadAttachmentFromServer(
    mailboxId,
    messageId,
    attachmentId,
    fileName,
    mimeType,
    signal,
  );
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");

  anchor.href = objectUrl;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);

  return file;
};
