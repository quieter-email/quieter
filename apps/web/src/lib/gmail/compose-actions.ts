import { getMailAddressKey, splitMailAddressList } from "@quietr/orpc/compose";
import type { MessageListItem } from "./gmail";
import {
  createEmptyComposeDraft,
  type ComposeDraftState,
  type ComposeReplyContext,
} from "./compose";
import { formatMessageDate, parseSender } from "./message-utils";

export type ComposeActionType = "reply" | "reply-all" | "forward";

const dedupeAddresses = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    const addressKey = getMailAddressKey(normalized);
    if (seen.has(addressKey)) continue;
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

  const normalizedEmail = currentUserEmail?.trim().toLowerCase();
  if (normalizedEmail) {
    owned.add(normalizedEmail);
  }

  return owned;
};

const filterOutOwnedAddresses = (
  values: readonly string[],
  ownedAddressKeys: ReadonlySet<string>,
) => values.filter((value) => !ownedAddressKeys.has(getMailAddressKey(value)));

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const textToHtml = (value: string) =>
  value
    .split(/\r?\n/g)
    .map((line) => (line ? escapeHtml(line) : "<br>"))
    .join("<br>");

const getMessageBodyHtml = (message: MessageListItem) => {
  const html = message.bodyHtml?.trim();
  if (html) return html;

  const text = message.bodyText?.trim() || message.snippet?.trim() || "";
  return text ? `<p>${textToHtml(text)}</p>` : "<p>(No message content)</p>";
};

const getMessageBodyText = (message: MessageListItem) => {
  const text = message.bodyText?.trim() || message.snippet?.trim();
  return text || "(No message content)";
};

const quotePlainText = (value: string) =>
  value
    .split(/\r?\n/g)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

const buildReplyLead = (message: MessageListItem) => {
  const sender = parseSender(message.from);
  const senderLabel = sender.display || sender.email || "Unknown sender";
  const sentAt = formatMessageDate(message, "full") || message.date?.trim() || "an earlier message";

  return `On ${sentAt}, ${senderLabel} wrote:`;
};

const buildForwardHeaderLines = (message: MessageListItem) => {
  const lines: string[] = [];

  if (message.from?.trim()) {
    lines.push(`From: ${message.from.trim()}`);
  }

  const sentAt = formatMessageDate(message, "full") || message.date?.trim();
  if (sentAt) {
    lines.push(`Date: ${sentAt}`);
  }

  if (message.subject?.trim()) {
    lines.push(`Subject: ${message.subject.trim()}`);
  }

  if (message.to?.trim()) {
    lines.push(`To: ${message.to.trim()}`);
  }

  if (message.cc?.trim()) {
    lines.push(`Cc: ${message.cc.trim()}`);
  }

  return lines;
};

const withSubjectPrefix = (
  subject: string | undefined,
  prefix: "Re:" | "Fwd:",
  pattern: RegExp,
) => {
  const normalizedSubject = subject?.trim() ?? "";
  if (!normalizedSubject) return prefix;
  if (pattern.test(normalizedSubject)) return normalizedSubject;
  return `${prefix} ${normalizedSubject}`;
};

const buildReplyContext = (message: MessageListItem): ComposeReplyContext | null => {
  const threadId = message.threadId?.trim();
  if (!threadId) return null;

  const messageHeaderId = message.messageHeaderId?.trim();
  const references = Array.from(
    new Set([
      ...(message.references?.match(/<[^>]+>/g) ?? []),
      ...(messageHeaderId ? [messageHeaderId] : []),
    ]),
  );

  return {
    threadId,
    messageHeaderId,
    references,
  };
};

const getReplyRecipients = (
  message: MessageListItem,
  currentUserEmail: string | null | undefined,
  includeAll: boolean,
) => {
  const ownedAddressKeys = buildOwnedAddressKeys(currentUserEmail);
  const fromEntries = dedupeAddresses(splitMailAddressList(message.from));
  const replyToEntries = dedupeAddresses(splitMailAddressList(message.replyTo));
  const toEntries = dedupeAddresses(splitMailAddressList(message.to));
  const ccEntries = dedupeAddresses(splitMailAddressList(message.cc));
  const senderIsOwned = fromEntries.some((entry) => ownedAddressKeys.has(getMailAddressKey(entry)));

  let primaryRecipients = filterOutOwnedAddresses(replyToEntries, ownedAddressKeys);
  if (primaryRecipients.length === 0) {
    primaryRecipients = filterOutOwnedAddresses(
      senderIsOwned ? toEntries : fromEntries,
      ownedAddressKeys,
    );
  }
  if (primaryRecipients.length === 0) {
    primaryRecipients = filterOutOwnedAddresses(toEntries, ownedAddressKeys);
  }

  const toRecipients = dedupeAddresses(primaryRecipients);
  const toRecipientKeys = new Set(toRecipients.map((entry) => getMailAddressKey(entry)));

  const ccRecipients = includeAll
    ? dedupeAddresses(
        filterOutOwnedAddresses(
          senderIsOwned ? ccEntries : [...fromEntries, ...toEntries, ...ccEntries],
          ownedAddressKeys,
        ).filter((entry) => !toRecipientKeys.has(getMailAddressKey(entry))),
      )
    : [];

  return {
    to: toRecipients.join(", "),
    cc: ccRecipients.join(", "),
    bcc: "",
  };
};

const normalizeRecipientField = (value: string) => value.trim().replaceAll(/\s+/g, " ");

export const hasDistinctReplyAllRecipients = (
  message: MessageListItem,
  currentUserEmail: string | null | undefined,
) => {
  const replyRecipients = getReplyRecipients(message, currentUserEmail, false);
  const replyAllRecipients = getReplyRecipients(message, currentUserEmail, true);

  return (
    normalizeRecipientField(replyRecipients.to) !==
      normalizeRecipientField(replyAllRecipients.to) ||
    normalizeRecipientField(replyRecipients.cc) !==
      normalizeRecipientField(replyAllRecipients.cc) ||
    normalizeRecipientField(replyRecipients.bcc) !== normalizeRecipientField(replyAllRecipients.bcc)
  );
};

export const getPreferredThreadActionMessage = (
  messages: readonly MessageListItem[],
  currentUserEmail: string | null | undefined,
) => {
  const ownedAddressKeys = buildOwnedAddressKeys(currentUserEmail);

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const senderEntries = dedupeAddresses(splitMailAddressList(message.from));
    const isOwnedMessage = senderEntries.some((entry) =>
      ownedAddressKeys.has(getMailAddressKey(entry)),
    );

    if (!isOwnedMessage) {
      return message;
    }
  }

  return messages[messages.length - 1] ?? null;
};

export const buildComposeDraftFromMessageAction = ({
  action,
  currentUserEmail,
  message,
}: {
  action: ComposeActionType;
  currentUserEmail: string | null | undefined;
  message: MessageListItem;
}): ComposeDraftState => {
  const draft = createEmptyComposeDraft();

  if (action === "forward") {
    const forwardedHeaderLines = buildForwardHeaderLines(message);
    const forwardedHeaderHtml =
      forwardedHeaderLines.length > 0
        ? `<p>${forwardedHeaderLines
            .map((line) => {
              const separatorIndex = line.indexOf(":");
              if (separatorIndex === -1) {
                return escapeHtml(line);
              }

              const label = line.slice(0, separatorIndex + 1);
              const value = line.slice(separatorIndex + 1).trim();
              return `<strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}`;
            })
            .join("<br>")}</p>`
        : "";

    return {
      ...draft,
      subject: withSubjectPrefix(message.subject, "Fwd:", /^fwd?:/i),
      bodyHtml: `<p><br></p><p>---------- Forwarded message ---------</p>${forwardedHeaderHtml}<blockquote>${getMessageBodyHtml(message)}</blockquote>`,
      bodyText: [
        "",
        "",
        "---------- Forwarded message ---------",
        ...forwardedHeaderLines,
        "",
        getMessageBodyText(message),
      ].join("\n"),
    };
  }

  const recipients = getReplyRecipients(message, currentUserEmail, action === "reply-all");
  const lead = buildReplyLead(message);

  return {
    ...draft,
    replyContext: buildReplyContext(message),
    recipients,
    subject: withSubjectPrefix(message.subject, "Re:", /^re:/i),
    bodyHtml: `<p><br></p><p>${escapeHtml(lead)}</p><blockquote>${getMessageBodyHtml(message)}</blockquote>`,
    bodyText: ["", "", lead, quotePlainText(getMessageBodyText(message))].join("\n"),
  };
};

export const buildComposeDraftFromSavedDraftMessage = (
  message: MessageListItem,
): ComposeDraftState => {
  const draft = createEmptyComposeDraft();

  return {
    ...draft,
    draftId: message.draftId,
    messageId: message.id,
    recipients: {
      to: message.to ?? "",
      cc: message.cc ?? "",
      bcc: message.bcc ?? "",
    },
    subject: message.subject ?? "",
    bodyHtml: message.bodyHtml ?? "",
    bodyText: message.bodyText ?? message.snippet ?? "",
    saveStatus: message.draftId ? "saved" : "idle",
    updatedAt: Date.now(),
  };
};
