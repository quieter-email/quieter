import { z } from "zod";

export const mailCategorySchema = z.enum([
  "inbox",
  "unread",
  "archive",
  "sent",
  "drafts",
  "spam",
  "trash",
]);

export type MailCategory = z.infer<typeof mailCategorySchema>;
export type MailSyncToken = string;

export type MailMessageSummary = {
  id: string;
  categories: MailCategory[];
  isUnread: boolean;
};

export type MailThreadSummary = {
  id: string;
  messageIds: string[];
  messages: MailMessageSummary[];
  subject?: string;
  snippet?: string;
  participants: string[];
  lastMessageAt?: string;
  messageCount: number;
  attachmentCount: number;
  categories: MailCategory[];
  isUnread: boolean;
  customLabelIds: string[];
  draftId?: string;
};

export type MailThreadPage = {
  threads: MailThreadSummary[];
  nextCursor?: string;
  syncToken?: MailSyncToken;
};

export type MailThreadDetail<TMessage = unknown> = {
  threadId: string;
  messages: TMessage[];
};

export type MailboxCapabilities = {
  categories: MailCategory[];
  canArchive: boolean;
  canDeletePermanently: boolean;
  canManageLabels: boolean;
  canMarkRead: boolean;
  canMoveToInbox: boolean;
  canMoveToSpam: boolean;
  canMoveToTrash: boolean;
  canSend: boolean;
};

export type MailCommand =
  | { kind: "set-read"; read: boolean }
  | { kind: "move"; destination: "archive" | "inbox" | "spam" | "trash" }
  | { kind: "delete-permanently" }
  | { kind: "set-labels"; addIds: string[]; removeIds: string[] };

export type MailMutationTarget = {
  threadId: string;
  messageIds: string[];
};

export type MailMutationTargetResult = {
  threadId: string;
  status: "applied" | "failed";
  code?: string;
  message?: string;
  summary?: MailThreadSummary;
};

export type MailMutationResult = {
  targets: MailMutationTargetResult[];
  syncToken?: MailSyncToken;
  badgeDelta?: Partial<Record<MailCategory, number>>;
};

export type MailErrorCode =
  | "invalid_request"
  | "permission_denied"
  | "rate_limited"
  | "reauthorization_required"
  | "temporary";

export type MailError = {
  code: MailErrorCode;
  message: string;
  retryAt?: string;
};

export const getMailboxCapabilities = (input: {
  provider: "api" | "gmail" | "managed";
  role?: "manager" | "reader" | "responder" | null;
}): MailboxCapabilities => {
  if (input.provider === "api") {
    return {
      categories: ["sent"],
      canArchive: false,
      canDeletePermanently: false,
      canManageLabels: false,
      canMarkRead: false,
      canMoveToInbox: false,
      canMoveToSpam: false,
      canMoveToTrash: false,
      canSend: false,
    };
  }

  const canRespond =
    input.provider === "gmail" || input.role === "manager" || input.role === "responder";
  return {
    categories: ["inbox", "unread", "archive", "sent", "drafts", "trash", "spam"],
    canArchive: canRespond,
    canDeletePermanently: canRespond,
    canManageLabels: input.provider === "gmail" || input.role === "manager",
    canMarkRead: canRespond,
    canMoveToInbox: canRespond,
    canMoveToSpam: canRespond,
    canMoveToTrash: canRespond,
    canSend: canRespond,
  };
};
