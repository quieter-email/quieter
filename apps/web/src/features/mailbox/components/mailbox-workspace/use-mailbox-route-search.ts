"use client";

import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";

import type { MailboxWorkspaceView } from "#/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxCategory } from "#/lib/gmail/gmail";
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

type MailboxSearchPatch = {
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

type InboxRouteState = {
  compose?: "mailto";
  mailto?: string;
  mailbox: MailboxRouteCategory;
  mailboxId?: string;
  messageId?: string;
  threadId?: string;
  query: string;
};

type ChatRouteState = {
  chatId?: string;
  compose?: "mailto";
  mailto?: string;
  mailbox: MailboxCategory;
  mailboxId?: string;
  messageId?: string;
  query: string;
  threadId?: string;
};

const defaultInboxRouteState: InboxRouteState = {
  mailbox: "inbox",
  query: "",
};

const defaultChatRouteState: ChatRouteState = {
  mailbox: "inbox",
  query: "",
};

const normalizeSearchValue = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? undefined : normalized;
};

const applyInboxPatch = (
  state: InboxRouteState,
  patch: MailboxSearchPatch
): InboxRouteState => {
  const { threadId: currentThreadId } = state;
  let threadId: string | undefined;
  if (patch.threadId !== undefined) {
    threadId = normalizeSearchValue(patch.threadId);
  } else if (patch.messageId === undefined) {
    threadId = currentThreadId;
  }

  return {
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
  };
};

const applyChatPatch = (
  state: ChatRouteState,
  patch: MailboxSearchPatch
): ChatRouteState => {
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
    mailbox:
      patch.mailbox === "template" || patch.mailbox === "compose"
        ? state.mailbox
        : (patch.mailbox ?? state.mailbox),
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
  };
};

export const useMailboxSearchActions = () => {
  const navigate = useNavigate({
    from: "/",
  });
  const inboxStateRef = useRef<InboxRouteState>(defaultInboxRouteState);
  const chatStateRef = useRef<ChatRouteState>(defaultChatRouteState);

  return async (
    patch: MailboxSearchPatch,
    { replace = true }: MailboxSearchOptions = {}
  ) => {
    await navigate({
      replace,
      resetScroll: false,
      search: (previous) => {
        if (previous.view === "chat") {
          chatStateRef.current = {
            chatId: previous.chatId,
            compose: previous.compose,
            mailbox:
              previous.mailbox === "template" || previous.mailbox === "compose"
                ? "inbox"
                : previous.mailbox,
            mailboxId: previous.mailboxId,
            mailto: previous.mailto,
            messageId: previous.messageId,
            query: previous.query,
            threadId: previous.threadId,
          };
        } else {
          inboxStateRef.current = {
            compose: previous.compose,
            mailbox: previous.mailbox,
            mailboxId: previous.mailboxId,
            mailto: previous.mailto,
            messageId: previous.messageId,
            query: previous.query,
            threadId: previous.threadId,
          };
        }

        const nextView = patch.view ?? previous.view;

        if (nextView === "chat") {
          const nextChatState = applyChatPatch(
            previous.view === "chat"
              ? chatStateRef.current
              : {
                  ...chatStateRef.current,
                  mailbox:
                    inboxStateRef.current.mailbox === "template" ||
                    inboxStateRef.current.mailbox === "compose"
                      ? "inbox"
                      : inboxStateRef.current.mailbox,
                  messageId: inboxStateRef.current.messageId,
                  query: inboxStateRef.current.query,
                  threadId: inboxStateRef.current.threadId,
                },
            patch
          );
          chatStateRef.current = nextChatState;

          return {
            chatId: nextChatState.chatId,
            compose: nextChatState.compose,
            mailbox: nextChatState.mailbox,
            mailboxId: nextChatState.mailboxId,
            mailto: nextChatState.mailto,
            messageId: nextChatState.messageId,
            query: nextChatState.query,
            threadId: nextChatState.threadId,
            view: "chat",
          };
        }

        const nextInboxState = applyInboxPatch(inboxStateRef.current, patch);
        inboxStateRef.current = nextInboxState;

        return {
          compose: nextInboxState.compose,
          mailbox: nextInboxState.mailbox,
          mailboxId: nextInboxState.mailboxId,
          mailto: nextInboxState.mailto,
          messageId: nextInboxState.messageId,
          query: nextInboxState.query,
          threadId: nextInboxState.threadId,
          view: nextView,
        };
      },
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
