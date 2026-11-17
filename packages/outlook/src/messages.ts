import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import { formatMailSender } from "@quieter/mail/compose/sender";
import {
  decodeMimeHeaderValue,
  extractInlineMessageAttachments,
  extractMessageAttachments,
} from "@quieter/mail/message-content";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import type {
  MessageListItem,
  MessagePart,
  ThreadMessagesResult,
} from "@quieter/mail/messages";
import { parseOtpTokenHeaders } from "@quieter/mail/otp-token";
import { getSenderAvatarUrls } from "@quieter/mail/sender-avatar";
import { createMailSnippet } from "@quieter/mail/snippet";
import {
  extractListUnsubscribeTargets,
  getUnsubscribeKey,
} from "@quieter/mail/unsubscribe";

import { OutlookGraphError } from "./graph";
import type { OutlookSystemFolders } from "./graph";
import type { OutlookAttachment, OutlookMessage } from "./graph-schemas";

export const getOutlookMessageWebLink = (
  message: OutlookMessage
): string | undefined => {
  if (message.webLink === undefined) {
    return undefined;
  }
  try {
    const url = new URL(message.webLink);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      ![
        "outlook.office.com",
        "outlook.office365.com",
        "outlook.live.com",
        "outlook.cloud.microsoft",
      ].includes(url.hostname)
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
};

export const normalizeOutlookMessage = async (input: {
  attachments: OutlookAttachment[];
  message: OutlookMessage;
  systemFolders: OutlookSystemFolders;
}): Promise<MessageListItem> => {
  const { attachments, message, systemFolders } = input;
  const headers = message.internetMessageHeaders ?? [];
  const readHeader = (name: string) =>
    decodeMimeHeaderValue(
      headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
        ?.value
    );
  const bodyHtml =
    message.body?.contentType === "html" ? message.body.content : undefined;
  const bodyText =
    message.body?.contentType === "text" ? message.body.content : undefined;
  const payload: MessagePart = {
    mimeType: "multipart/mixed",
    parts: attachments.map((attachment) => ({
      body: { attachmentId: attachment.id, size: attachment.size },
      filename: attachment.name,
      headers: [
        {
          name: "Content-Disposition",
          value: attachment.isInline === true ? "inline" : "attachment",
        },
        ...("contentId" in attachment && attachment.contentId
          ? [{ name: "Content-ID", value: attachment.contentId }]
          : []),
      ],
      mimeType: attachment.contentType ?? "application/octet-stream",
    })),
  };
  const recipientFields = [
    "bccRecipients",
    "ccRecipients",
    "replyTo",
    "toRecipients",
  ] as const;
  const recipients: Partial<Record<(typeof recipientFields)[number], string>> =
    {};
  for (const field of recipientFields) {
    const value = message[field]
      ?.map(({ emailAddress }) =>
        formatMailSender({
          address: emailAddress.address,
          name: emailAddress.name ?? "",
        })
      )
      .join(", ");
    if (value) {
      recipients[field] = value;
    }
  }
  const from =
    readHeader("From") ??
    (message.from
      ? formatMailSender({
          address: message.from.emailAddress.address,
          name: message.from.emailAddress.name ?? "",
        })
      : undefined);
  const unsubscribe = extractListUnsubscribeTargets(
    readHeader("List-Unsubscribe")
  );
  const labelIds: string[] = [
    { folderId: systemFolders.inbox, label: MAILBOX_LABELS.inbox },
    { folderId: systemFolders.sent, label: MAILBOX_LABELS.sent },
    { folderId: systemFolders.spam, label: MAILBOX_LABELS.spam },
    { folderId: systemFolders.trash, label: MAILBOX_LABELS.trash },
  ]
    .filter(({ folderId }) => folderId === message.parentFolderId)
    .map(({ label }) => label);
  if (message.isDraft) {
    labelIds.push(MAILBOX_LABELS.drafts);
  }
  if (!message.isRead) {
    labelIds.push(MAILBOX_LABELS.unread);
  }
  for (const category of message.categories ?? []) {
    labelIds.push(`outlook-category:${encodeURIComponent(category)}`);
  }
  const date =
    message.receivedDateTime ?? message.sentDateTime ?? message.createdDateTime;
  const sourceUrl = getOutlookMessageWebLink(message);
  return {
    attachments: extractMessageAttachments(payload, bodyHtml),
    baseRevision: message.isDraft ? message.changeKey : undefined,
    bcc: readHeader("Bcc") ?? recipients.bccRecipients,
    bodyHtml,
    bodyText,
    cc: readHeader("Cc") ?? recipients.ccRecipients,
    date:
      readHeader("Date") ??
      message.sentDateTime ??
      message.receivedDateTime ??
      message.createdDateTime,
    draftAnchor: parseDraftAnchorFromHeaderReader(readHeader),
    draftId: message.isDraft ? message.id : undefined,
    from,
    id: message.id,
    inReplyTo: readHeader("In-Reply-To"),
    inlineImages: extractInlineMessageAttachments(payload, bodyHtml),
    internalDate: date === undefined ? undefined : String(Date.parse(date)),
    isUnread: !message.isRead,
    labelIds,
    messageHeaderId: readHeader("Message-ID") ?? message.internetMessageId,
    otpToken: parseOtpTokenHeaders(headers) ?? undefined,
    receivedAt: message.receivedDateTime,
    references: readHeader("References"),
    replyTo: readHeader("Reply-To") ?? recipients.replyTo,
    senderAvatarUrls: await getSenderAvatarUrls(from, { headers }),
    snippet: message.bodyPreview ?? createMailSnippet({ bodyHtml, bodyText }),
    ...(sourceUrl === undefined
      ? {}
      : { source: { kind: "external" as const, url: sourceUrl } }),
    subject: readHeader("Subject") ?? message.subject,
    threadId: message.conversationId,
    to: readHeader("To") ?? recipients.toRecipients,
    unsubscribeKey: getUnsubscribeKey(
      readHeader("From") === undefined && from !== undefined
        ? [...headers, { name: "From", value: from }]
        : headers
    ),
    unsubscribeMailto: unsubscribe.mailto,
    unsubscribeUrl: unsubscribe.url,
  };
};

export const aggregateOutlookThread = (input: {
  messages: MessageListItem[];
  threadId: string;
}): ThreadMessagesResult => {
  if (input.messages.some((message) => message.threadId !== input.threadId)) {
    throw new OutlookGraphError("invalid_response");
  }
  const messages = [
    ...new Map(input.messages.map((message) => [message.id, message])).values(),
  ].toSorted(
    (a, b) =>
      Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0) ||
      a.id.localeCompare(b.id)
  );
  const labels = [
    ...new Set(messages.flatMap((message) => message.labelIds ?? [])),
  ];
  const attachments = messages.flatMap((message) => message.attachments ?? []);
  const latest = messages.at(-1);
  return {
    messages: messages.map((message) => ({
      ...message,
      threadAttachmentCount: attachments.length,
      threadAttachmentNames: attachments.map(
        (attachment) => attachment.fileName
      ),
      threadLabelIds: labels,
      threadMessageCount: messages.length,
    })),
    snippet: latest?.snippet,
    subject: latest?.subject,
    threadId: input.threadId,
  };
};
