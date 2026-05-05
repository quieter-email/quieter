"use client";

import {
  Attachment01Icon,
  Download01Icon,
  FileEditIcon,
  FileZipIcon,
  Image01Icon,
  MusicNote01Icon,
  Pdf01Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
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

const primaryMime = (mimeType: string) => mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

const extensionOf = (fileName: string): string => {
  const base = fileName.trim().split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
};

const getAttachmentTypeIcon = (mimeType: string, fileName: string): IconSvgElement => {
  const mime = primaryMime(mimeType);
  const ext = extensionOf(fileName);

  if (mime === "application/pdf" || ext === "pdf") {
    return Pdf01Icon;
  }

  if (
    mime.startsWith("image/") ||
    ["avif", "bmp", "gif", "heic", "ico", "jpeg", "jpg", "png", "svg", "webp"].includes(ext)
  ) {
    return Image01Icon;
  }

  if (
    mime.startsWith("video/") ||
    ["avi", "m4v", "mkv", "mov", "mp4", "mpeg", "mpg", "webm", "wmv"].includes(ext)
  ) {
    return Video01Icon;
  }

  if (
    mime.startsWith("audio/") ||
    ["aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"].includes(ext)
  ) {
    return MusicNote01Icon;
  }

  const archiveMime =
    mime === "application/gzip" ||
    mime === "application/vnd.rar" ||
    mime === "application/x-7z-compressed" ||
    mime === "application/x-gzip" ||
    mime === "application/x-rar-compressed" ||
    mime === "application/x-tar" ||
    mime === "application/x-zip-compressed" ||
    mime === "application/zip" ||
    mime.includes("rar") ||
    mime.includes("7z");

  if (archiveMime || ["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip"].includes(ext)) {
    return FileZipIcon;
  }

  const docishMime =
    mime === "application/json" ||
    mime === "application/msword" ||
    mime === "application/rtf" ||
    mime.startsWith("application/vnd.ms-") ||
    mime.startsWith("application/vnd.openxmlformats-officedocument") ||
    mime.startsWith("text/");

  if (
    docishMime ||
    [
      "csv",
      "doc",
      "docx",
      "json",
      "log",
      "md",
      "odp",
      "ods",
      "odt",
      "ppt",
      "pptx",
      "rtf",
      "txt",
      "xls",
      "xlsx",
      "xml",
    ].includes(ext)
  ) {
    return FileEditIcon;
  }

  return Attachment01Icon;
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
    <section aria-label="Attachments" className={cn("w-full min-w-0", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {attachments.map((attachment) => {
          const attachmentKey = `${attachment.messageId}:${attachment.attachmentId}`;
          const isDownloading = activeAttachmentKey === attachmentKey;
          const sizeLabel = attachment.size > 0 ? formatAttachmentSize(attachment.size) : null;
          const typeIcon = getAttachmentTypeIcon(attachment.mimeType, attachment.fileName);

          return (
            <button
              aria-busy={isDownloading}
              className={cn(
                "squircle inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs text-foreground",
                "bg-muted/25 shadow-xs ring-1 ring-border/55 ring-inset",
                "transition-colors hover:bg-muted/45",
                "focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:outline-none",
                "disabled:cursor-progress disabled:opacity-65",
              )}
              disabled={isDownloading}
              key={attachmentKey}
              onClick={() => {
                void handleDownload(attachment);
              }}
              title={isDownloading ? `Downloading ${attachment.fileName}` : attachment.fileName}
              type="button"
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                <HugeiconsIcon
                  aria-hidden="true"
                  className={cn("size-3.5", { "animate-pulse text-foreground": isDownloading })}
                  icon={isDownloading ? Download01Icon : typeIcon}
                />
              </span>

              {sizeLabel ? (
                <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
                  <span className="truncate font-medium">{attachment.fileName}</span>
                  <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
                    · {sizeLabel}
                  </span>
                </span>
              ) : (
                <span className="min-w-0 truncate font-medium">{attachment.fileName}</span>
              )}
            </button>
          );
        })}
      </div>

      {errorMessage ? (
        <p className="mt-1.5 text-xs leading-snug text-destructive">{errorMessage}</p>
      ) : null}
    </section>
  );
};
