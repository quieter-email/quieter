"use client";

import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import type { MailboxWorkspaceView } from "~/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { MailboxSearch } from "~/routes/index";
import { inboxRouteApi } from "~/lib/route-apis";

type MailboxSearchPatch = {
  chatId?: string | null;
  compose?: "mailto" | null;
  mailto?: string | null;
  mailbox?: MailboxCategory;
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
  mailbox: MailboxCategory;
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

const normalizeSearchValue = (value: string | null | undefined) => value?.trim() || undefined;

const normalizeComposeValue = (value: "mailto" | null | undefined) => value ?? undefined;

const applyInboxPatch = (state: InboxRouteState, patch: MailboxSearchPatch): InboxRouteState => ({
  compose: patch.compose === undefined ? state.compose : normalizeComposeValue(patch.compose),
  mailto: patch.mailto === undefined ? state.mailto : normalizeSearchValue(patch.mailto),
  mailbox: patch.mailbox ?? state.mailbox,
  mailboxId:
    patch.mailboxId === undefined ? state.mailboxId : normalizeSearchValue(patch.mailboxId),
  messageId:
    patch.messageId === undefined ? state.messageId : normalizeSearchValue(patch.messageId),
  threadId:
    patch.threadId === undefined
      ? patch.messageId === undefined
        ? state.threadId
        : undefined
      : normalizeSearchValue(patch.threadId),
  query: patch.query === undefined ? state.query : (patch.query?.trim() ?? ""),
});

const applyChatPatch = (state: ChatRouteState, patch: MailboxSearchPatch): ChatRouteState => ({
  chatId: patch.chatId === undefined ? state.chatId : normalizeSearchValue(patch.chatId),
  compose: patch.compose === undefined ? state.compose : normalizeComposeValue(patch.compose),
  mailto: patch.mailto === undefined ? state.mailto : normalizeSearchValue(patch.mailto),
  mailbox: patch.mailbox ?? state.mailbox,
  mailboxId:
    patch.mailboxId === undefined ? state.mailboxId : normalizeSearchValue(patch.mailboxId),
  messageId:
    patch.messageId === undefined ? state.messageId : normalizeSearchValue(patch.messageId),
  query: patch.query === undefined ? state.query : (patch.query?.trim() ?? ""),
  threadId:
    patch.threadId === undefined
      ? patch.messageId === undefined
        ? state.threadId
        : undefined
      : normalizeSearchValue(patch.threadId),
});

export const useMailboxSearchActions = () => {
  const navigate = useNavigate({
    from: "/",
  });
  const inboxStateRef = useRef<InboxRouteState>(defaultInboxRouteState);
  const chatStateRef = useRef<ChatRouteState>(defaultChatRouteState);

  return (patch: MailboxSearchPatch, { replace = true }: MailboxSearchOptions = {}) => {
    return navigate({
      replace,
      resetScroll: false,
      search: (previous) => {
        if (previous.view === "chat") {
          chatStateRef.current = {
            chatId: previous.chatId,
            compose: previous.compose,
            mailto: previous.mailto,
            mailbox: previous.mailbox,
            mailboxId: previous.mailboxId,
            messageId: previous.messageId,
            query: previous.query,
            threadId: previous.threadId,
          };
        } else {
          inboxStateRef.current = {
            compose: previous.compose,
            mailto: previous.mailto,
            mailbox: previous.mailbox,
            mailboxId: previous.mailboxId,
            messageId: previous.messageId,
            threadId: previous.threadId,
            query: previous.query,
          };
        }

        const nextView = patch.view ?? previous.view;

        if (nextView === "chat") {
          const nextChatState = applyChatPatch(
            previous.view === "chat"
              ? chatStateRef.current
              : {
                  ...chatStateRef.current,
                  mailbox: inboxStateRef.current.mailbox,
                  messageId: inboxStateRef.current.messageId,
                  query: inboxStateRef.current.query,
                  threadId: inboxStateRef.current.threadId,
                },
            patch,
          );
          chatStateRef.current = nextChatState;

          return {
            chatId: nextChatState.chatId,
            compose: nextChatState.compose,
            mailto: nextChatState.mailto,
            mailbox: nextChatState.mailbox,
            mailboxId: nextChatState.mailboxId,
            messageId: nextChatState.messageId,
            query: nextChatState.query,
            threadId: nextChatState.threadId,
            view: "chat",
          } as MailboxSearch;
        }

        const nextInboxState = applyInboxPatch(inboxStateRef.current, patch);
        inboxStateRef.current = nextInboxState;

        return {
          compose: nextInboxState.compose,
          mailto: nextInboxState.mailto,
          mailbox: nextInboxState.mailbox,
          mailboxId: nextInboxState.mailboxId,
          messageId: nextInboxState.messageId,
          threadId: nextInboxState.threadId,
          query: nextInboxState.query,
          view: "inbox",
        } as MailboxSearch;
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
  const activeMailbox = inboxRouteApi.useSearch({
    select: (search) => search.mailbox,
  });
  const chatId = inboxRouteApi.useSearch({
    select: (search) => search.chatId,
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
    mailto,
    mailboxId,
    messageId,
    query,
    setMailboxSearch,
    threadId,
    view,
  };
};
