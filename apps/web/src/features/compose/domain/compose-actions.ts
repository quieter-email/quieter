import {
  getMailAddressKey,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import type { ComposeDraftAnchor } from "@quieter/mail/compose/schema";

import type { MessageListItem } from "#/lib/gmail/gmail";
import { formatMessageDate, parseSender } from "#/lib/gmail/message-utils";

import {
  createEmptyComposeDraft,
  escapeComposeHtml,
  normalizeComposeBodyHtml,
} from "./draft";
import type { ComposeDraftState, ComposeReplyContext } from "./draft";

type ComposeActionType = "reply" | "reply-all" | "forward";

const dedupeAddresses = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const addressKey = getMailAddressKey(normalized);
    if (seen.has(addressKey)) {
      continue;
    }
    seen.add(addressKey);
    deduped.push(normalized);
  }

  return deduped;
};

const buildOwnedAddressKeys = (currentUserEmail: string | null | undefined) => {
  const owned = new Set<string>();

  for (const entry of splitMailAddressList(currentUserEmail ?? "")) {
    owned.add(getMailAddressKey(entry));
  }

  const normalizedEmail = currentUserEmail?.trim().toLowerCase() ?? "";
  if (normalizedEmail !== "") {
    owned.add(normalizedEmail);
  }

  return owned;
};

const filterOutOwnedAddresses = (
  values: readonly string[],
  ownedAddressKeys: ReadonlySet<string>
) => values.filter((value) => !ownedAddressKeys.has(getMailAddressKey(value)));

const textToHtml = (value: string) =>
  value
    .split(/\r?\n/gu)
    .map((line) => (line ? escapeComposeHtml(line) : "<br>"))
    .join("<br>");

const getMessageBodyHtml = (message: MessageListItem) => {
  const html = message.bodyHtml?.trim() ?? "";
  if (html !== "") {
    return html;
  }

  const text = message.bodyText?.trim() ?? message.snippet?.trim() ?? "";
  if (text !== "") {
    return `<p>${textToHtml(text)}</p>`;
  }
  return "<p>(No message content)</p>";
};

const getMessageBodyText = (message: MessageListItem) => {
  const text = message.bodyText?.trim() ?? message.snippet?.trim() ?? "";
  if (text !== "") {
    return text;
  }
  return "(No message content)";
};

const quotePlainText = (value: string) =>
  value
    .split(/\r?\n/gu)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

const buildReplyLead = (message: MessageListItem) => {
  const sender = parseSender(message.from);
  const senderDisplay = sender.display?.trim() ?? "";
  const senderEmail = sender.email?.trim() ?? "";
  let senderLabel = "Unknown sender";
  if (senderDisplay !== "") {
    senderLabel = senderDisplay;
  } else if (senderEmail !== "") {
    senderLabel = senderEmail;
  }
  const formattedDate = formatMessageDate(message, "full");
  const rawDate = message.date?.trim() ?? "";
  let sentAt = "an earlier message";
  if ((formattedDate?.trim() ?? "") !== "") {
    sentAt = formattedDate ?? sentAt;
  } else if (rawDate !== "") {
    sentAt = rawDate;
  }

  return `On ${sentAt}, ${senderLabel} wrote:`;
};

const buildForwardHeaderLines = (message: MessageListItem) => {
  const lines: string[] = [];

  const from = message.from?.trim() ?? "";
  if (from !== "") {
    lines.push(`From: ${from}`);
  }

  const sentAt =
    formatMessageDate(message, "full") ?? message.date?.trim() ?? "";
  if (sentAt !== "") {
    lines.push(`Date: ${sentAt}`);
  }

  const subject = message.subject?.trim() ?? "";
  if (subject !== "") {
    lines.push(`Subject: ${subject}`);
  }

  const to = message.to?.trim() ?? "";
  if (to !== "") {
    lines.push(`To: ${to}`);
  }

  const cc = message.cc?.trim() ?? "";
  if (cc !== "") {
    lines.push(`Cc: ${cc}`);
  }

  return lines;
};

const withSubjectPrefix = (
  subject: string | undefined,
  prefix: "Re:" | "Fwd:",
  pattern: RegExp
) => {
  const normalizedSubject = subject?.trim() ?? "";
  if (normalizedSubject === "") {
    return prefix;
  }
  if (pattern.test(normalizedSubject)) {
    return normalizedSubject;
  }
  return `${prefix} ${normalizedSubject}`;
};

const buildReplyContext = (
  message: MessageListItem,
  options?: { useInReplyTo?: boolean }
): ComposeReplyContext | null => {
  const threadId = message.threadId?.trim();
  if (!threadId) {
    return null;
  }

  const messageHeaderId = (
    options?.useInReplyTo === true ? message.inReplyTo : message.messageHeaderId
  )?.trim();
  const references = [
    ...new Set([
      ...(message.references?.match(/<[^>]+>/gu) ?? []),
      ...(messageHeaderId !== undefined && messageHeaderId !== ""
        ? [messageHeaderId]
        : []),
    ]),
  ];

  return {
    messageHeaderId,
    references,
    threadId,
  };
};

const buildDraftAnchor = (
  message: MessageListItem,
  action: ComposeActionType
): ComposeDraftAnchor | null => {
  const sourceMessageId = message.id?.trim();
  const sourceThreadId = message.threadId?.trim();

  if (!sourceMessageId || !sourceThreadId) {
    return null;
  }

  const sourceMessageHeaderId = message.messageHeaderId?.trim() ?? "";

  return {
    seededBy: action,
    sourceMessageHeaderId:
      sourceMessageHeaderId === ""
        ? undefined
        : message.messageHeaderId?.trim(),
    sourceMessageId,
    sourceThreadId,
  };
};

const getMessageTimestamp = (message: MessageListItem): number => {
  const source = message.internalDate ?? message.date;
  if (source === undefined || source === null || source === "") {
    return 0;
  }

  const numeric = Number(source);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(source);
  const timestamp = parsed.getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const getReplyRecipients = (
  message: MessageListItem,
  currentUserEmail: string | null | undefined,
  includeAll: boolean
) => {
  const ownedAddressKeys = buildOwnedAddressKeys(currentUserEmail);
  const fromEntries = dedupeAddresses(splitMailAddressList(message.from));
  const replyToEntries = dedupeAddresses(splitMailAddressList(message.replyTo));
  const toEntries = dedupeAddresses(splitMailAddressList(message.to));
  const ccEntries = dedupeAddresses(splitMailAddressList(message.cc));
  const senderIsOwned = fromEntries.some((entry) =>
    ownedAddressKeys.has(getMailAddressKey(entry))
  );

  let primaryRecipients = filterOutOwnedAddresses(
    replyToEntries,
    ownedAddressKeys
  );
  if (primaryRecipients.length === 0) {
    primaryRecipients = filterOutOwnedAddresses(
      senderIsOwned ? toEntries : fromEntries,
      ownedAddressKeys
    );
  }
  if (primaryRecipients.length === 0) {
    primaryRecipients = filterOutOwnedAddresses(toEntries, ownedAddressKeys);
  }

  const toRecipients = dedupeAddresses(primaryRecipients);
  const toRecipientKeys = new Set(
    toRecipients.map((entry) => getMailAddressKey(entry))
  );

  const ccRecipients = includeAll
    ? dedupeAddresses(
        filterOutOwnedAddresses(
          senderIsOwned
            ? ccEntries
            : [...fromEntries, ...toEntries, ...ccEntries],
          ownedAddressKeys
        ).filter((entry) => !toRecipientKeys.has(getMailAddressKey(entry)))
      )
    : [];

  return {
    bcc: "",
    cc: ccRecipients.join(", "),
    to: toRecipients.join(", "),
  };
};

const normalizeRecipientField = (value: string) =>
  value.trim().replaceAll(/\s+/gu, " ");

const hasSavedDraftBody = (draft: ComposeDraftState) => {
  const bodyHtml = normalizeComposeBodyHtml(draft.bodyHtml);
  const bodyText = draft.bodyText.trim();
  return bodyHtml !== "" || bodyText !== "";
};

export const buildComposeDraftFromSavedDraftMessage = (
  message: MessageListItem
): ComposeDraftState => {
  const draft = createEmptyComposeDraft();

  return {
    ...draft,
    bodyHtml: message.bodyHtml ?? "",
    bodyText: message.bodyText ?? message.snippet ?? "",
    draftAnchor: message.draftAnchor ?? null,
    draftId: message.draftId,
    messageId: message.id,
    recipients: {
      bcc: message.bcc ?? "",
      cc: message.cc ?? "",
      to: message.to ?? "",
    },
    replyContext: buildReplyContext(message, { useInReplyTo: true }),
    saveStatus: (message.draftId?.trim() ?? "") === "" ? "idle" : "saved",
    subject: message.subject ?? "",
    updatedAt: Date.now(),
  };
};

export const hasDistinctReplyAllRecipients = (
  message: MessageListItem,
  currentUserEmail: string | null | undefined
) => {
  const replyRecipients = getReplyRecipients(message, currentUserEmail, false);
  const replyAllRecipients = getReplyRecipients(
    message,
    currentUserEmail,
    true
  );

  return (
    normalizeRecipientField(replyRecipients.to) !==
      normalizeRecipientField(replyAllRecipients.to) ||
    normalizeRecipientField(replyRecipients.cc) !==
      normalizeRecipientField(replyAllRecipients.cc) ||
    normalizeRecipientField(replyRecipients.bcc) !==
      normalizeRecipientField(replyAllRecipients.bcc)
  );
};

export const buildComposeDraftFromMessageAction = ({
  action,
  currentUserEmail,
  existingDraftMessage,
  message,
}: {
  action: ComposeActionType;
  currentUserEmail: string | null | undefined;
  existingDraftMessage?: MessageListItem | null;
  message: MessageListItem;
}): ComposeDraftState => {
  const existingDraftId = existingDraftMessage?.draftId?.trim() ?? "";
  if (existingDraftId !== "" && existingDraftMessage) {
    const existingDraft =
      buildComposeDraftFromSavedDraftMessage(existingDraftMessage);
    if (hasSavedDraftBody(existingDraft)) {
      const fallbackRecipients =
        action === "forward"
          ? {
              bcc: "",
              cc: "",
              to: "",
            }
          : getReplyRecipients(
              message,
              currentUserEmail,
              action === "reply-all"
            );

      return {
        ...existingDraft,
        draftAnchor: buildDraftAnchor(message, action),
        recipients: {
          bcc:
            (existingDraft.recipients.bcc?.trim() ?? "") === ""
              ? fallbackRecipients.bcc
              : existingDraft.recipients.bcc,
          cc:
            (existingDraft.recipients.cc?.trim() ?? "") === ""
              ? fallbackRecipients.cc
              : existingDraft.recipients.cc,
          to:
            (existingDraft.recipients.to?.trim() ?? "") === ""
              ? fallbackRecipients.to
              : existingDraft.recipients.to,
        },
        updatedAt: Date.now(),
      };
    }
  }

  const draft = createEmptyComposeDraft();
  const replyContext = buildReplyContext(message);
  const draftAnchor = buildDraftAnchor(message, action);

  if (action === "forward") {
    const forwardedHeaderLines = buildForwardHeaderLines(message);
    const forwardedHeaderHtml =
      forwardedHeaderLines.length > 0
        ? `<p>${forwardedHeaderLines
            .map((line) => {
              const separatorIndex = line.indexOf(":");
              if (separatorIndex === -1) {
                return escapeComposeHtml(line);
              }

              const label = line.slice(0, separatorIndex + 1);
              const value = line.slice(separatorIndex + 1).trim();
              return `<strong>${escapeComposeHtml(label)}</strong> ${escapeComposeHtml(value)}`;
            })
            .join("<br>")}</p>`
        : "";

    return {
      ...draft,
      bodyHtml: `<p><br></p><p>---------- Forwarded message ---------</p>${forwardedHeaderHtml}<blockquote>${getMessageBodyHtml(message)}</blockquote>`,
      bodyText: [
        "",
        "",
        "---------- Forwarded message ---------",
        ...forwardedHeaderLines,
        "",
        getMessageBodyText(message),
      ].join("\n"),
      draftAnchor,
      replyContext,
      subject: withSubjectPrefix(message.subject, "Fwd:", /^fwd?:/iu),
    };
  }

  const recipients = getReplyRecipients(
    message,
    currentUserEmail,
    action === "reply-all"
  );
  const lead = buildReplyLead(message);

  return {
    ...draft,
    bodyHtml: `<p><br></p><p>${escapeComposeHtml(lead)}</p><blockquote>${getMessageBodyHtml(message)}</blockquote>`,
    bodyText: ["", "", lead, quotePlainText(getMessageBodyText(message))].join(
      "\n"
    ),
    draftAnchor,
    recipients,
    replyContext,
    subject: withSubjectPrefix(message.subject, "Re:", /^re:/iu),
  };
};

export const findLinkedDraftForMessage = (
  messages: readonly MessageListItem[],
  sourceMessage: MessageListItem
): MessageListItem | null => {
  const sourceDraftId = sourceMessage.draftId?.trim() ?? "";
  if (sourceDraftId !== "") {
    return null;
  }

  let linkedDraft: MessageListItem | null = null;

  for (const message of messages) {
    const draftId = message.draftId?.trim() ?? "";
    if (draftId === "" || message.id === sourceMessage.id) {
      continue;
    }

    const anchorSourceMessageId =
      message.draftAnchor?.sourceMessageId?.trim() ?? "";
    const anchorSourceThreadId =
      message.draftAnchor?.sourceThreadId?.trim() ?? "";
    const matchesByAnchor =
      anchorSourceMessageId === sourceMessage.id &&
      anchorSourceThreadId === sourceMessage.threadId;

    if (!matchesByAnchor) {
      continue;
    }

    if (
      !linkedDraft ||
      getMessageTimestamp(message) > getMessageTimestamp(linkedDraft)
    ) {
      linkedDraft = message;
    }
  }

  return linkedDraft;
};
