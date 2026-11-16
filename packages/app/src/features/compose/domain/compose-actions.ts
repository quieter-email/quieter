import type { ComposeActionDraft } from "@quieter/app/features/compose/domain/compose-action-quote";
import {
  createEmptyComposeDraft,
  normalizeComposeBodyHtml,
} from "@quieter/app/features/compose/domain/draft";
import type {
  ComposeDraftState,
  ComposeReplyContext,
} from "@quieter/app/features/compose/domain/draft";
import { parseSender } from "@quieter/app/lib/gmail/message-utils";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { buildComposeMessageQuotes } from "@quieter/mail/compose/message-quote";
import {
  getMailAddressKey,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import type { ComposeDraftAnchor } from "@quieter/mail/compose/schema";
import { extractMessageIds } from "@quieter/mail/message-id";

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
      ...extractMessageIds(message.references),
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
    attachments: (message.attachments ?? []).map((attachment) => ({
      gmailAttachmentId: attachment.attachmentId,
      id: crypto.randomUUID(),
      isInline: false,
      mimeType: attachment.mimeType,
      name: attachment.fileName,
      size: attachment.size,
      sourceMessageId: message.id,
    })),
    baseRevision: message.baseRevision,
    bodyHtml: message.bodyHtml ?? "",
    bodyText: message.bodyText ?? message.snippet ?? "",
    draftAnchor: message.draftAnchor ?? null,
    draftId: message.draftId,
    inlineImages: (message.inlineImages ?? []).map((image) => ({
      contentId: image.contentId,
      gmailAttachmentId: image.attachmentId,
      id: crypto.randomUUID(),
      isInline: true,
      mimeType: image.mimeType,
      name: image.fileName,
      size: image.size,
      sourceMessageId: message.id,
    })),
    lastSavedAt: getMessageTimestamp(message) || undefined,
    messageId: message.id,
    recipients: {
      bcc: message.bcc ?? "",
      cc: message.cc ?? "",
      to: message.to ?? "",
    },
    replyContext: buildReplyContext(message, { useInReplyTo: true }),
    saveStatus: (message.draftId?.trim() ?? "") === "" ? "idle" : "saved",
    senderName: parseSender(message.from).name || undefined,
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
}): ComposeActionDraft => {
  const quotedImages = (message.inlineImages ?? []).map((image) => ({
    contentId: image.contentId,
    gmailAttachmentId: image.attachmentId,
    id: crypto.randomUUID(),
    isInline: true as const,
    mimeType: image.mimeType,
    name: image.fileName,
    size: image.size,
    sourceMessageId: message.id,
  }));
  const forwardedAttachments = (message.attachments ?? []).map(
    (attachment) => ({
      gmailAttachmentId: attachment.attachmentId,
      id: crypto.randomUUID(),
      isInline: false as const,
      mimeType: attachment.mimeType,
      name: attachment.fileName,
      size: attachment.size,
      sourceMessageId: message.id,
    })
  );
  const { replyHtml, replyText, forwardHtml, forwardText } =
    buildComposeMessageQuotes(message);
  const actionQuote = {
    attachments: action === "forward" ? forwardedAttachments : [],
    forwardHtml,
    html: action === "forward" ? forwardHtml : replyHtml,
    inlineImages: quotedImages,
    replyHtml,
  };
  const existingDraftId = existingDraftMessage?.draftId?.trim() ?? "";
  const existingDraft =
    existingDraftId !== "" &&
    existingDraftMessage &&
    (action === "forward") ===
      (existingDraftMessage.draftAnchor?.seededBy === "forward")
      ? buildComposeDraftFromSavedDraftMessage(existingDraftMessage)
      : null;
  if (existingDraft && hasSavedDraftBody(existingDraft)) {
    const fallbackRecipients =
      action === "forward"
        ? {
            bcc: "",
            cc: "",
            to: "",
          }
        : getReplyRecipients(message, currentUserEmail, action === "reply-all");

    return {
      ...existingDraft,
      actionQuote,
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
      replyContext: action === "forward" ? null : buildReplyContext(message),
      updatedAt: Date.now(),
    };
  }

  const draft = existingDraft ?? createEmptyComposeDraft();
  const replyContext = buildReplyContext(message);
  const draftAnchor = buildDraftAnchor(message, action);

  if (action === "forward") {
    return {
      ...draft,
      actionQuote,
      attachments: forwardedAttachments,
      bodyHtml: `<p><br></p>${forwardHtml}`,
      bodyText: forwardText,
      draftAnchor,
      inlineImages: quotedImages,
      replyContext: null,
      subject: withSubjectPrefix(message.subject, "Fwd:", /^fwd?:/iu),
    };
  }

  const recipients = getReplyRecipients(
    message,
    currentUserEmail,
    action === "reply-all"
  );

  return {
    ...draft,
    actionQuote,
    bodyHtml: `<p><br></p>${replyHtml}`,
    bodyText: replyText,
    draftAnchor,
    inlineImages: quotedImages,
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
    if (
      draftId === "" ||
      message.id === sourceMessage.id ||
      message.draftAnchor?.seededBy === "forward"
    ) {
      continue;
    }

    const anchorSourceMessageId =
      message.draftAnchor?.sourceMessageId?.trim() ?? "";
    const anchorSourceThreadId =
      message.draftAnchor?.sourceThreadId?.trim() ?? "";
    const sourceThreadId = sourceMessage.threadId?.trim() ?? "";
    const matchesByAnchor =
      sourceThreadId !== "" &&
      anchorSourceMessageId === sourceMessage.id &&
      anchorSourceThreadId === sourceThreadId;
    const matchesByThread =
      sourceThreadId !== "" &&
      (anchorSourceThreadId || message.threadId?.trim()) === sourceThreadId;

    if (!matchesByAnchor && !matchesByThread) {
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
