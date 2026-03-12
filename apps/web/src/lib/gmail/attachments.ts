import { trpc } from "~/lib/trpc";

const now = () => Date.now();

export const loadAttachmentFromServer = async (
  messageId: string,
  attachmentId: string,
  fileName: string,
  mimeType: string,
  signal?: AbortSignal,
) => {
  const attachment = await trpc.gmail.getAttachment.query({ messageId, attachmentId }, { signal });
  const bytes = Uint8Array.from(attachment.bytes);

  return new File([bytes], fileName, {
    type: mimeType,
    lastModified: now(),
  });
};

export const downloadAttachmentFromServer = async (
  messageId: string,
  attachmentId: string,
  fileName: string,
  mimeType: string,
  signal?: AbortSignal,
) => {
  const file = await loadAttachmentFromServer(messageId, attachmentId, fileName, mimeType, signal);
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
