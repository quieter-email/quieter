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
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { toast } from "@quieter/ui/toast";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";

import {
  connectorsQueryOptions,
  openConnectorLink,
} from "#/lib/connectors-query";
import { downloadAttachmentFromServer } from "#/lib/gmail/attachments";
import type { MessageAttachment } from "#/lib/gmail/gmail";
import { rpc } from "#/lib/orpc";
import { getErrorMessage } from "#/lib/orpc-errors";

type ThreadAttachment = MessageAttachment & {
  messageId: string;
};

type MessageAttachmentsProps = {
  attachments: ThreadAttachment[];
  mailboxId: string;
  className?: string;
};

const formatAttachmentSize = (size: number) => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  const megabytes = size / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
};

const isCalendarAttachment = (attachment: MessageAttachment) => {
  const mime = attachment.mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const baseName = attachment.fileName.trim().split(/[/\\]/u).pop() ?? "";
  return mime === "text/calendar" || baseName.toLowerCase().endsWith(".ics");
};

const imageExtensions = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

const videoExtensions = new Set([
  "avi",
  "m4v",
  "mkv",
  "mov",
  "mp4",
  "mpeg",
  "mpg",
  "webm",
  "wmv",
]);

const audioExtensions = new Set([
  "aac",
  "aif",
  "aiff",
  "flac",
  "m4a",
  "mp3",
  "ogg",
  "opus",
  "wav",
  "wma",
]);

const archiveExtensions = new Set([
  "7z",
  "bz2",
  "gz",
  "rar",
  "tar",
  "tgz",
  "xz",
  "zip",
]);

const documentExtensions = new Set([
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
]);

const hasMimePrefix = (mime: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => mime.startsWith(prefix));

const hasMimePrefixOrExtension = (
  mime: string,
  extension: string,
  prefixes: readonly string[],
  extensions: ReadonlySet<string>
) => hasMimePrefix(mime, prefixes) || extensions.has(extension);

const isArchiveMime = (mime: string) =>
  new Set([
    "application/gzip",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/x-gzip",
    "application/x-rar-compressed",
    "application/x-tar",
    "application/x-zip-compressed",
    "application/zip",
  ]).has(mime) ||
  mime.includes("rar") ||
  mime.includes("7z");

const isDocumentMime = (mime: string) =>
  new Set(["application/json", "application/msword", "application/rtf"]).has(
    mime
  ) ||
  mime.startsWith("application/vnd.ms-") ||
  mime.startsWith("application/vnd.openxmlformats-officedocument") ||
  mime.startsWith("text/");

const getAttachmentTypeIcon = (
  mimeType: string,
  fileName: string
): IconSvgElement => {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const baseName = fileName.trim().split(/[/\\]/u).pop() ?? "";
  const dotIndex = baseName.lastIndexOf(".");
  const ext = dotIndex === -1 ? "" : baseName.slice(dotIndex + 1).toLowerCase();

  if (mime === "application/pdf" || ext === "pdf") {
    return Pdf01Icon;
  }

  if (hasMimePrefixOrExtension(mime, ext, ["image/"], imageExtensions)) {
    return Image01Icon;
  }

  if (hasMimePrefixOrExtension(mime, ext, ["video/"], videoExtensions)) {
    return Video01Icon;
  }

  if (hasMimePrefixOrExtension(mime, ext, ["audio/"], audioExtensions)) {
    return MusicNote01Icon;
  }

  if (isArchiveMime(mime) || archiveExtensions.has(ext)) {
    return FileZipIcon;
  }

  if (isDocumentMime(mime) || documentExtensions.has(ext)) {
    return FileEditIcon;
  }

  return Attachment01Icon;
};

export const MessageAttachments = ({
  attachments,
  className,
  mailboxId,
}: MessageAttachmentsProps) => {
  const [activeCalendarAttachmentKey, setActiveCalendarAttachmentKey] =
    useState<string | null>(null);
  const [activeDownloadAttachmentKey, setActiveDownloadAttachmentKey] =
    useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasCalendarAttachments = attachments.some(isCalendarAttachment);
  const { data: connectorsData, isLoading: areConnectorsLoading } = useQuery({
    ...connectorsQueryOptions(),
    enabled: hasCalendarAttachments,
  });

  if (attachments.length === 0) {
    return null;
  }

  const googleCalendarConnector = connectorsData?.connectors.find(
    (connector) => connector.provider === "google_calendar"
  );
  const isGoogleCalendarConnected =
    googleCalendarConnector?.status === "connected";

  const handleDownload = async (attachment: ThreadAttachment) => {
    const attachmentKey = `${attachment.messageId}:${attachment.attachmentId}`;
    setActiveDownloadAttachmentKey(attachmentKey);
    setErrorMessage(null);

    const [downloadResult] = await Promise.allSettled([
      downloadAttachmentFromServer(
        mailboxId,
        attachment.messageId,
        attachment.attachmentId,
        attachment.fileName,
        attachment.mimeType
      ),
    ]);
    if (downloadResult.status === "rejected") {
      setErrorMessage(
        getErrorMessage(
          downloadResult.reason,
          `Could not download ${attachment.fileName}.`
        )
      );
    }
    setActiveDownloadAttachmentKey((current) =>
      current === attachmentKey ? null : current
    );
  };

  const handleCalendarAction = async (attachment: ThreadAttachment) => {
    const attachmentKey = `${attachment.messageId}:${attachment.attachmentId}`;
    setActiveCalendarAttachmentKey(attachmentKey);
    setErrorMessage(null);

    const performAction = async () => {
      if (!isGoogleCalendarConnected) {
        await openConnectorLink({
          provider: "google_calendar",
          returnTo: "/settings?tab=connectors",
        });
        return;
      }

      const result = await rpc.connectors.addGoogleCalendarIcsAttachment({
        attachmentId: attachment.attachmentId,
        mailboxId,
        messageId: attachment.messageId,
      });
      toast.success(`Added ${result.summary} to Google Calendar.`);
    };
    const [calendarResult] = await Promise.allSettled([performAction()]);
    if (calendarResult.status === "rejected") {
      setErrorMessage(
        getErrorMessage(
          calendarResult.reason,
          `Could not add ${attachment.fileName} to Google Calendar.`
        )
      );
    }
    setActiveCalendarAttachmentKey((current) =>
      current === attachmentKey ? null : current
    );
  };

  return (
    <section
      aria-label="Attachments"
      className={cn("w-full min-w-0", className)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {attachments.map((attachment) => {
          const attachmentKey = `${attachment.messageId}:${attachment.attachmentId}`;
          const isCalendarPending =
            activeCalendarAttachmentKey === attachmentKey;
          const isDownloadPending =
            activeDownloadAttachmentKey === attachmentKey;
          const isCalendarInvite = isCalendarAttachment(attachment);
          const sizeLabel =
            attachment.size > 0 ? formatAttachmentSize(attachment.size) : null;
          const typeIcon = getAttachmentTypeIcon(
            attachment.mimeType,
            attachment.fileName
          );

          let calendarActionLabel = "Connect Google Calendar";
          if (areConnectorsLoading) {
            calendarActionLabel = "Checking Calendar";
          } else if (isGoogleCalendarConnected) {
            calendarActionLabel = "Add to Google Calendar";
          }

          return (
            <Fragment key={attachmentKey}>
              {isCalendarInvite ? (
                <button
                  aria-busy={isCalendarPending}
                  className={cn(
                    "squircle inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-caption text-fg",
                    "bg-muted/25 shadow-xs ring-1 ring-border/55 ring-inset",
                    "transition-colors hover:bg-muted/45",
                    "disabled:cursor-progress disabled:opacity-65"
                  )}
                  disabled={isCalendarPending || areConnectorsLoading}
                  onClick={() => {
                    void handleCalendarAction(attachment);
                  }}
                  title={attachment.fileName}
                  type="button"
                >
                  <span className="flex size-5 shrink-0 items-center justify-center text-muted-fg">
                    <HugeiconsIcon
                      aria-hidden="true"
                      className={cn("size-3.5", {
                        "animate-pulse text-fg":
                          isCalendarPending || areConnectorsLoading,
                      })}
                      icon={CalendarAdd01Icon}
                    />
                  </span>
                  <span className="min-w-0 truncate font-medium">
                    {calendarActionLabel}
                  </span>
                </button>
              ) : null}

              <button
                aria-busy={isDownloadPending}
                className={cn(
                  "squircle inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-caption text-fg",
                  "bg-muted/25 shadow-xs ring-1 ring-border/55 ring-inset",
                  "transition-colors hover:bg-muted/45",
                  "disabled:cursor-progress disabled:opacity-65"
                )}
                disabled={isDownloadPending}
                onClick={() => {
                  void handleDownload(attachment);
                }}
                title={
                  isDownloadPending
                    ? `Downloading ${attachment.fileName}`
                    : attachment.fileName
                }
                type="button"
              >
                <span className="flex size-5 shrink-0 items-center justify-center text-muted-fg">
                  <HugeiconsIcon
                    aria-hidden="true"
                    className={cn("size-3.5", {
                      "animate-pulse text-fg": isDownloadPending,
                    })}
                    icon={isDownloadPending ? Download01Icon : typeIcon}
                  />
                </span>

                {sizeLabel !== null &&
                sizeLabel !== undefined &&
                sizeLabel !== "" ? (
                  <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1">
                    <span className="truncate font-medium">
                      {attachment.fileName}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-muted-fg tabular-nums">
                      {sizeLabel}
                    </span>
                  </span>
                ) : (
                  <span className="min-w-0 truncate font-medium">
                    {attachment.fileName}
                  </span>
                )}
              </button>
            </Fragment>
          );
        })}
      </div>

      {errorMessage !== null &&
      errorMessage !== undefined &&
      errorMessage !== "" ? (
        <p className="mt-1.5 text-caption/snug text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
};
