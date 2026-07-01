"use client";

import {
  Attachment01Icon,
  CalendarAdd01Icon,
  Download01Icon,
  FileEditIcon,
  FileZipIcon,
  Image01Icon,
  MusicNote01Icon,
  Pdf01Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { toast } from "@quieter/ui/toast";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { MessageAttachment } from "~/lib/gmail/gmail";
import { connectorsQueryOptions, openConnectorLink } from "~/lib/connectors-query";
import { downloadAttachmentFromServer } from "~/lib/gmail/attachments";
import { rpc } from "~/lib/orpc";

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

const isCalendarAttachment = (attachment: MessageAttachment) => {
  const mime = attachment.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const baseName = attachment.fileName.trim().split(/[/\\]/).pop() ?? "";
  return mime === "text/calendar" || baseName.toLowerCase().endsWith(".ics");
};

const getAttachmentTypeIcon = (mimeType: string, fileName: string): IconSvgElement => {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const baseName = fileName.trim().split(/[/\\]/).pop() ?? "";
  const dotIndex = baseName.lastIndexOf(".");
  const ext = dotIndex >= 0 ? baseName.slice(dotIndex + 1).toLowerCase() : "";

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
  const hasCalendarAttachments = attachments.some(isCalendarAttachment);
  const { data: connectorsData, isLoading: areConnectorsLoading } = useQuery({
    ...connectorsQueryOptions(),
    enabled: hasCalendarAttachments,
  });

  if (attachments.length === 0) return null;

  const googleCalendarConnector = connectorsData?.connectors.find(
    (connector) => connector.provider === "google_calendar",
  );
  const isGoogleCalendarConnected = googleCalendarConnector?.status === "connected";

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
      setActiveAttachmentKey((current) => (current === attachmentKey ? null : current));
    } catch (error) {
      setErrorMessage(
        (error as { message?: string })?.message ?? `Could not download ${attachment.fileName}.`,
      );
      setActiveAttachmentKey((current) => (current === attachmentKey ? null : current));
    }
  };

  const handleCalendarAction = async (attachment: ThreadAttachment) => {
    const attachmentKey = `${attachment.messageId}:${attachment.attachmentId}`;
    setActiveAttachmentKey(attachmentKey);
    setErrorMessage(null);

    try {
      if (!isGoogleCalendarConnected) {
        await openConnectorLink({
          provider: "google_calendar",
          returnTo: "/settings?tab=connectors",
        });
        setActiveAttachmentKey((current) => (current === attachmentKey ? null : current));
        return;
      }

      const result = await rpc.connectors.addGoogleCalendarIcsAttachment({
        attachmentId: attachment.attachmentId,
        mailboxId,
        messageId: attachment.messageId,
      });
      toast.success(`Added ${result.summary} to Google Calendar.`);
      setActiveAttachmentKey((current) => (current === attachmentKey ? null : current));
    } catch (error) {
      setErrorMessage(
        (error as { message?: string })?.message ??
          `Could not add ${attachment.fileName} to Google Calendar.`,
      );
      setActiveAttachmentKey((current) => (current === attachmentKey ? null : current));
    }
  };

  return (
    <section aria-label="Attachments" className={cn("w-full min-w-0", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {attachments.map((attachment) => {
          const attachmentKey = `${attachment.messageId}:${attachment.attachmentId}`;
          const isDownloading = activeAttachmentKey === attachmentKey;
          const isCalendarInvite = isCalendarAttachment(attachment);
          const sizeLabel = attachment.size > 0 ? formatAttachmentSize(attachment.size) : null;
          const typeIcon = getAttachmentTypeIcon(attachment.mimeType, attachment.fileName);

          if (isCalendarInvite) {
            const label = areConnectorsLoading
              ? "Checking Calendar"
              : isGoogleCalendarConnected
                ? "Add to Google Calendar"
                : "Connect Google Calendar";

            return (
              <button
                aria-busy={isDownloading}
                className={cn(
                  "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs text-foreground squircle",
                  "bg-muted/25 shadow-xs ring-1 ring-border/55 ring-inset",
                  "transition-colors hover:bg-muted/45",
                  "focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:outline-none",
                  "disabled:cursor-progress disabled:opacity-65",
                )}
                disabled={isDownloading || areConnectorsLoading}
                key={attachmentKey}
                onClick={() => {
                  void handleCalendarAction(attachment);
                }}
                title={attachment.fileName}
                type="button"
              >
                <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                  <HugeiconsIcon
                    aria-hidden="true"
                    className={cn("size-3.5", {
                      "animate-pulse text-foreground": isDownloading || areConnectorsLoading,
                    })}
                    icon={isDownloading ? Download01Icon : CalendarAdd01Icon}
                  />
                </span>
                <span className="min-w-0 truncate font-medium">{label}</span>
              </button>
            );
          }

          return (
            <button
              aria-busy={isDownloading}
              className={cn(
                "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs text-foreground squircle",
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
                    {sizeLabel}
                  </span>
                </span>
              ) : (
                <span className="min-w-0 truncate font-medium">{attachment.fileName}</span>
              )}
            </button>
          );
        })}
      </div>

      {errorMessage ? <p className="mt-1.5 text-xs/snug text-destructive">{errorMessage}</p> : null}
    </section>
  );
};
