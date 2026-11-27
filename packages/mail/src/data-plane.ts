import { z } from "zod";

import type { MailSnoozeState } from "./snooze";

export const mailCategorySchema = z.enum([
  "inbox",
  "done",
  "later",
  "important",
  "unread",
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
  isImportant?: boolean;
};

export type MailThreadSummary = {
  snooze?: MailSnoozeState;
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
  isImportant?: boolean;
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
  canDeletePermanently: boolean;
  canManageKnowledge: boolean;
  canManageLabels: boolean;
  canMarkRead: boolean;
  canSetImportance: boolean;
  canSetPlacement: boolean;
  canMoveToInbox: boolean;
  canMoveToSpam: boolean;
  canMoveToTrash: boolean;
  canSend: boolean;
  canSetSenderName: boolean;
};

export type MailCommand =
  | { kind: "set-read"; read: boolean }
  | { kind: "set-importance"; important: boolean }
  | { kind: "set-placement"; placement: "done" | "inbox" }
  | { kind: "move"; destination: "inbox" | "spam" | "trash" }
  | { kind: "delete-permanently" }
  | { kind: "set-labels"; addIds: string[]; removeIds: string[] };

export type MailMutationTarget = {
  threadId: string;
  messageIds: string[];
};

export type MailMutationTargetResult = {
  appliedMessageIds?: string[];
  failedMessageIds?: string[];
  uncertainMessageIds?: string[];
  threadId: string;
  status: "applied" | "failed";
  code?: string;
  message?: string;
  summary?: MailThreadSummary;
  operationId?: string;
  replayed?: boolean;
  messageIds?: string[];
};

export type MailMutationResult = {
  receipt?: {
    requestId: string;
    status: "completed" | "pending" | "uncertain";
  };
  targets: MailMutationTargetResult[];
  syncToken?: MailSyncToken;
  confirmedThreadSummaries?: MailThreadSummary[];
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
      canDeletePermanently: false,
      canManageKnowledge: false,
      canManageLabels: false,
      canMarkRead: false,
      canMoveToInbox: false,
      canMoveToSpam: false,
      canMoveToTrash: false,
      canSend: false,
      canSetImportance: false,
      canSetPlacement: false,
      canSetSenderName: false,
      categories: ["sent"],
    };
  }

  const canRespond =
    input.provider === "gmail" ||
    input.role === "manager" ||
    input.role === "responder";
  return {
    canDeletePermanently: false,
    canManageKnowledge: input.provider === "gmail" || input.role === "manager",
    canManageLabels: input.provider === "gmail" || input.role === "manager",
    canMarkRead: canRespond,
    canMoveToInbox: canRespond,
    canMoveToSpam: canRespond,
    canMoveToTrash: canRespond,
    canSend: canRespond,
    canSetImportance: canRespond,
    canSetPlacement: canRespond,
    canSetSenderName: input.provider === "managed" && canRespond,
    categories: [
      "inbox",
      "done",
      "later",
      "important",
      "unread",
      "sent",
      "drafts",
      "trash",
      "spam",
    ],
  };
};
