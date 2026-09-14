import {
  findInvalidMailAddresses,
  splitMailAddressList,
  getMailAddressKey,
  extractMailAddress,
} from "@quieter/mail/compose/schema";
import type { ComposeDraftAnchor } from "@quieter/mail/compose/schema";
import type { MessageListItem } from "@quieter/mail/messages";

export type ComposeMode = "forward" | "new" | "reply" | "reply-all";

export type MobileComposeDraft = {
  attachments: [];
  bodyHtml: string;
  bodyText: string;
  draftAnchor: ComposeDraftAnchor | null;
  draftId: null;
  headers?: [];
  inlineImages: [];
  localId: string;
  recipients: { bcc: string; cc: string; to: string };
  replyContext: {
    messageHeaderId?: string;
    references: string[];
    threadId: string;
  } | null;
  saveStatus: "idle" | "saving" | "saved" | "error" | "sending";
  subject: string;
  updatedAt: number;
};

export const createEmptyComposeDraft = (): MobileComposeDraft => ({
  attachments: [],
  bodyHtml: "",
  bodyText: "",
  draftAnchor: null,
  draftId: null,
  inlineImages: [],
  localId: `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  recipients: { bcc: "", cc: "", to: "" },
  replyContext: null,
  saveStatus: "idle",
  subject: "",
  updatedAt: Date.now(),
});

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

const dedupeAddresses = (entries: readonly string[]) => {
  const seen = new Set<string>();
  return entries.flatMap((entry) => {
    const key = getMailAddressKey(entry);
    if (key.length === 0 || seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [entry];
  });
};

const buildOwnedAddressKeys = (currentUserEmail: string | null | undefined) => {
  const keys = new Set<string>();
  if (currentUserEmail === null || currentUserEmail === undefined) {
    return keys;
  }
  for (const entry of splitMailAddressList(currentUserEmail)) {
    keys.add(getMailAddressKey(entry));
  }
  return keys;
};

const getReplyRecipients = (
  message: MessageListItem,
  currentUserEmail: string | null | undefined,
  includeAll: boolean
) => {
  const ownedAddressKeys = buildOwnedAddressKeys(currentUserEmail);
  const fromEntries = dedupeAddresses(splitMailAddressList(message.from));
  const replyToEntries = dedupeAddresses(splitMailAddressList(message.replyTo));
  const senderIsOwned = fromEntries.some((entry) =>
    ownedAddressKeys.has(getMailAddressKey(entry))
  );
  const fallbackEntries = [
    ...dedupeAddresses(splitMailAddressList(message.to)),
    ...dedupeAddresses(splitMailAddressList(message.cc)),
  ];
  let primaryEntries = fromEntries;
  if (replyToEntries.length > 0) {
    primaryEntries = replyToEntries;
  } else if (senderIsOwned) {
    primaryEntries = fallbackEntries;
  }
  const toEntries = dedupeAddresses(primaryEntries).filter(
    (entry) => !ownedAddressKeys.has(getMailAddressKey(entry))
  );

  if (!includeAll) {
    return {
      bcc: "",
      cc: "",
      to: toEntries.join(", "),
    };
  }

  const excludedKeys = new Set([
    ...ownedAddressKeys,
    ...toEntries.map((entry) => getMailAddressKey(entry)),
  ]);
  const ccEntries = [
    ...dedupeAddresses(splitMailAddressList(message.to)),
    ...dedupeAddresses(splitMailAddressList(message.cc)),
  ].filter((entry) => !excludedKeys.has(getMailAddressKey(entry)));

  return {
    bcc: "",
    cc: ccEntries.join(", "),
    to: toEntries.join(", "),
  };
};

const buildReplyContext = (
  message: MessageListItem,
  options?: { useInReplyTo?: boolean }
): MobileComposeDraft["replyContext"] => {
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

  return { messageHeaderId, references, threadId };
};

const buildDraftAnchor = (
  message: MessageListItem,
  mode: ComposeMode
): ComposeDraftAnchor | null => {
  const sourceMessageId = message.id?.trim();
  const sourceThreadId = message.threadId?.trim();
  if (!sourceMessageId || !sourceThreadId || mode === "new") {
    return null;
  }

  const sourceMessageHeaderId = message.messageHeaderId?.trim() ?? "";
  return {
    seededBy: mode,
    sourceMessageHeaderId:
      sourceMessageHeaderId === "" ? undefined : sourceMessageHeaderId,
    sourceMessageId,
    sourceThreadId,
  };
};

const quoteText = (message: MessageListItem) => {
  const sender = message.from?.trim() ?? "";
  const body = (message.bodyText ?? message.snippet ?? "").trim();
  const quoted = body
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `${sender} wrote:\n${quoted}`;
};

const textToHtml = (text: string) =>
  text
    .split(/\n{2,}/u)
    .map(
      (paragraph) =>
        `<p>${paragraph
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll("\n", "<br />")}</p>`
    )
    .join("");

export const buildComposeDraft = ({
  currentUserEmail,
  message,
  mode,
}: {
  currentUserEmail: string | null | undefined;
  message: MessageListItem | null;
  mode: ComposeMode;
}): MobileComposeDraft => {
  const draft = createEmptyComposeDraft();
  if (message === null || mode === "new") {
    return draft;
  }

  const replyContext = buildReplyContext(message);
  const draftAnchor = buildDraftAnchor(message, mode);

  if (mode === "forward") {
    const headerLines = [
      message.from ? `From: ${message.from}` : null,
      message.to ? `To: ${message.to}` : null,
      message.cc ? `Cc: ${message.cc}` : null,
      message.subject ? `Subject: ${message.subject}` : null,
    ].filter((line): line is string => line !== null);
    const body = (message.bodyText ?? message.snippet ?? "").trim();
    const forwarded = `${headerLines.join("\n")}\n\n${body}`;

    return {
      ...draft,
      bodyHtml: textToHtml(forwarded),
      bodyText: forwarded,
      draftAnchor,
      replyContext,
      subject: withSubjectPrefix(message.subject, "Fwd:", /^fwd:/iu),
    };
  }

  const recipients = getReplyRecipients(
    message,
    currentUserEmail,
    mode === "reply-all"
  );
  const quoted = quoteText(message);
  const bodyText = `\n\n${quoted}`;

  return {
    ...draft,
    bodyHtml: textToHtml(bodyText.trimStart()),
    bodyText,
    draftAnchor,
    recipients,
    replyContext: buildReplyContext(message, { useInReplyTo: true }),
    subject: withSubjectPrefix(message.subject, "Re:", /^re:/iu),
  };
};

export const validateComposeDraft = (draft: MobileComposeDraft) => {
  if (splitMailAddressList(draft.recipients.to).length === 0) {
    return "Add at least one recipient in To.";
  }

  const invalid = [
    ...findInvalidMailAddresses(draft.recipients.to),
    ...findInvalidMailAddresses(draft.recipients.cc),
    ...findInvalidMailAddresses(draft.recipients.bcc),
  ];
  if (invalid.length > 0) {
    return `These addresses are invalid: ${invalid
      .map((entry) => extractMailAddress(entry))
      .join(", ")}`;
  }

  return null;
};

export const buildOutgoingBody = (
  bodyText: string
): { bodyHtml: string; bodyText: string } => ({
  bodyHtml: textToHtml(bodyText.trim()),
  bodyText: bodyText.trim(),
});
