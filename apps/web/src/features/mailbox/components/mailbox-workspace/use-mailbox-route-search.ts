"use client";

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef } from "react";
import type { MailboxWorkspaceView } from "~/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { MailboxSearch } from "~/routes/index";
import { inboxRouteApi } from "~/lib/route-apis";

type MailboxSearchPatch = {
  chatId?: string | null;
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
  mailbox: MailboxCategory;
  mailboxId?: string;
  messageId?: string;
  threadId?: string;
  query: string;
};

type ChatRouteState = {
  chatId?: string;
  mailboxId?: string;
};

const defaultInboxRouteState: InboxRouteState = {
  mailbox: "inbox",
  query: "",
};

const defaultChatRouteState: ChatRouteState = {};

const normalizeSearchValue = (value: string | null | undefined) => value?.trim() || undefined;

const applyInboxPatch = (state: InboxRouteState, patch: MailboxSearchPatch): InboxRouteState => ({
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
  mailboxId:
    patch.mailboxId === undefined ? state.mailboxId : normalizeSearchValue(patch.mailboxId),
});

export const useMailboxSearchActions = () => {
  const navigate = useNavigate({
    from: "/",
  });
  const inboxStateRef = useRef<InboxRouteState>(defaultInboxRouteState);
  const chatStateRef = useRef<ChatRouteState>(defaultChatRouteState);

  return useCallback(
    (patch: MailboxSearchPatch, { replace = true }: MailboxSearchOptions = {}) => {
      return navigate({
        replace,
        resetScroll: false,
        search: (previous) => {
          if (previous.view === "chat") {
            chatStateRef.current = {
              chatId: previous.chatId,
              mailboxId: previous.mailboxId,
            };
          } else {
            inboxStateRef.current = {
              mailbox: previous.mailbox,
              mailboxId: previous.mailboxId,
              messageId: previous.messageId,
              threadId: previous.threadId,
              query: previous.query,
            };
          }

          const nextView = patch.view ?? previous.view;

          if (nextView === "chat") {
            const nextChatState = applyChatPatch(chatStateRef.current, patch);
            chatStateRef.current = nextChatState;

            return {
              chatId: nextChatState.chatId,
              mailboxId: nextChatState.mailboxId,
              view: "chat",
            } as MailboxSearch;
          }

          const nextInboxState = applyInboxPatch(inboxStateRef.current, patch);
          inboxStateRef.current = nextInboxState;

          return {
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
    },
    [navigate],
  );
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
    mailboxId,
    query,
    setMailboxSearch,
    view,
  };
};
