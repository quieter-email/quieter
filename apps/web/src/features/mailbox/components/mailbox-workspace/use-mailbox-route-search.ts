"use client";

import { useNavigate } from "@tanstack/react-router";

import type { MailboxWorkspaceView } from "#/features/mailbox/domain/mailbox-workspace-view";
import { inboxRouteApi } from "#/lib/route-apis";

const MAILBOX_ROUTE_CATEGORIES = [
  "inbox",
  "unread",
  "archive",
  "spam",
  "sent",
  "trash",
  "drafts",
  "template",
  "compose",
] as const;

type MailboxRouteCategory = (typeof MAILBOX_ROUTE_CATEGORIES)[number];

export type MailboxSearchPatch = {
  chatId?: string | null;
  compose?: "mailto" | null;
  mailto?: string | null;
  mailbox?: MailboxRouteCategory;
  mailboxId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  query?: string | null;
  view?: MailboxWorkspaceView;
};

type MailboxSearchOptions = {
  replace?: boolean;
};

export type MailboxRouteState = {
  chatId?: string;
  compose?: "mailto";
  mailbox: MailboxRouteCategory;
  mailboxId?: string;
  mailto?: string;
  messageId?: string;
  query: string;
  threadId?: string;
  view: MailboxWorkspaceView;
};

const normalizeSearchValue = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? undefined : normalized;
};

export const applyMailboxSearchPatch = (
  state: MailboxRouteState,
  patch: MailboxSearchPatch
): MailboxRouteState => {
  const { threadId: currentThreadId } = state;
  let threadId: string | undefined;
  if (patch.threadId !== undefined) {
    threadId = normalizeSearchValue(patch.threadId);
  } else if (patch.messageId === undefined) {
    threadId = currentThreadId;
  }

  return {
    chatId:
      patch.chatId === undefined
        ? state.chatId
        : normalizeSearchValue(patch.chatId),
    compose:
      patch.compose === undefined
        ? state.compose
        : (patch.compose ?? undefined),
    mailbox: patch.mailbox ?? state.mailbox,
    mailboxId:
      patch.mailboxId === undefined
        ? state.mailboxId
        : normalizeSearchValue(patch.mailboxId),
    mailto:
      patch.mailto === undefined
        ? state.mailto
        : normalizeSearchValue(patch.mailto),
    messageId:
      patch.messageId === undefined
        ? state.messageId
        : normalizeSearchValue(patch.messageId),
    query:
      patch.query === undefined ? state.query : (patch.query?.trim() ?? ""),
    threadId,
    view: patch.view ?? state.view,
  };
};

export const useMailboxSearchActions = () => {
  const navigate = useNavigate({ from: "/" });

  return async (
    patch: MailboxSearchPatch,
    { replace = true }: MailboxSearchOptions = {}
  ) => {
    await navigate({
      replace,
      resetScroll: false,
      search: (previous) => applyMailboxSearchPatch(previous, patch),
      to: ".",
    });
  };
};

export const useMailboxMessageId = () =>
  inboxRouteApi.useSearch({
    select: (search) => search.messageId,
  });

export const useMailboxThreadId = () =>
  inboxRouteApi.useSearch({
    select: (search) => search.threadId,
  });

export const useMailboxRouteSearch = () => {
  const routeMailbox = inboxRouteApi.useSearch({
    select: (search) => search.mailbox,
  });
  const isTemplateMailbox = routeMailbox === "template";
  const isComposeMailbox = routeMailbox === "compose";
  const activeMailbox =
    routeMailbox === "template" || routeMailbox === "compose"
      ? "inbox"
      : routeMailbox;
  const chatId = inboxRouteApi.useSearch({
    select: (search) => search.chatId,
  });
  const gmailLink = inboxRouteApi.useSearch({
    select: (search) => search.gmailLink,
  });
  const mailboxId = inboxRouteApi.useSearch({
    select: (search) => search.mailboxId,
  });
  const messageId = inboxRouteApi.useSearch({
    select: (search) => search.messageId,
  });
  const threadId = inboxRouteApi.useSearch({
    select: (search) => search.threadId,
  });
  const compose = inboxRouteApi.useSearch({
    select: (search) => search.compose,
  });
  const mailto = inboxRouteApi.useSearch({
    select: (search) => search.mailto,
  });
  const query = inboxRouteApi.useSearch({
    select: (search) => search.query,
  });
  const view = inboxRouteApi.useSearch({
    select: (search) => search.view,
  });
  const setMailboxSearch = useMailboxSearchActions();

  return {
    activeMailbox,
    chatId,
    compose,
    gmailLink,
    isComposeMailbox,
    isTemplateMailbox,
    mailboxId,
    mailto,
    messageId,
    query,
    setMailboxSearch,
    threadId,
    view,
  };
};
