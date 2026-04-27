"use client";

import { Attachment01Icon, Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@quieter/ui";
import { useState } from "react";
import type { MessageAttachment } from "~/lib/gmail/gmail";
import { getErrorMessage } from "~/lib/errors";
import { downloadAttachmentFromServer } from "~/lib/gmail/attachments";

type ThreadAttachment = MessageAttachment & {
  messageId: string;
};

type MessageAttachmentsProps = {
  attachments: ThreadAttachment[];
  mailboxId: string;
  className?: string;
};

const formatAttachmentSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;

  const megabytes = size / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
};

export const MessageAttachments = ({
  attachments,
  className,
  mailboxId,
}: MessageAttachmentsProps) => {
  const [activeAttachmentKey, setActiveAttachmentKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (attachments.length === 0) return null;

  const handleDownload = async (attachment: ThreadAttachment) => {
    const attachmentKey = `${attachment.messageId}:${attachment.attachmentId}`;
    setActiveAttachmentKey(attachmentKey);
    setErrorMessage(null);

    try {
      await downloadAttachmentFromServer(
        mailboxId,
        attachment.messageId,
        attachment.attachmentId,
        attachment.fileName,
        attachment.mimeType,
      );
    } catch (error) {
      setErrorMessage(getErrorMessage(error, `Could not download ${attachment.fileName}.`));
    } finally {
      setActiveAttachmentKey((current) => (current === attachmentKey ? null : current));
    }
  };

  return (
    <section aria-label="Attachments" className={className}>
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => {
          const attachmentKey = `${attachment.messageId}:${attachment.attachmentId}`;
          const isDownloading = activeAttachmentKey === attachmentKey;

          return (
            <button
              aria-busy={isDownloading}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1.5 text-left text-sm font-medium text-foreground hover:bg-muted/40 disabled:cursor-progress disabled:opacity-70"
              disabled={isDownloading}
              key={attachmentKey}
              onClick={() => {
                void handleDownload(attachment);
              }}
              title={isDownloading ? `Downloading ${attachment.fileName}` : attachment.fileName}
              type="button"
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                <HugeiconsIcon
                  aria-hidden="true"
                  className={cn("size-4", { "text-foreground": isDownloading })}
                  icon={isDownloading ? Download01Icon : Attachment01Icon}
                />
              </span>

              <span className="max-w-[18rem] truncate">{attachment.fileName}</span>

              {attachment.size > 0 ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatAttachmentSize(attachment.size)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
    </section>
  );
};
