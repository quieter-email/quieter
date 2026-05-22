"use client";

import { useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import type { MailboxWorkspaceView } from "~/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { MailboxSearch } from "~/routes/index";
import { inboxRouteApi } from "~/lib/route-apis";

type MailboxSearchPatch = {
  chatId?: string | null;
  mailbox?: MailboxCategory;
  mailboxId?: string | null;
  messageId?: string | null;
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
  query: string;
};

type ChatRouteState = {
  chatId?: string;
  mailboxId?: string;
};

const normalizeSearchValue = (value: string | null | undefined) => value?.trim() || undefined;

const applyInboxPatch = (state: InboxRouteState, patch: MailboxSearchPatch): InboxRouteState => ({
  mailbox: patch.mailbox ?? state.mailbox,
  mailboxId:
    patch.mailboxId === undefined ? state.mailboxId : normalizeSearchValue(patch.mailboxId),
  messageId:
    patch.messageId === undefined ? state.messageId : normalizeSearchValue(patch.messageId),
  query: patch.query === undefined ? state.query : (patch.query?.trim() ?? ""),
});

const applyChatPatch = (state: ChatRouteState, patch: MailboxSearchPatch): ChatRouteState => ({
  chatId: patch.chatId === undefined ? state.chatId : normalizeSearchValue(patch.chatId),
  mailboxId:
    patch.mailboxId === undefined ? state.mailboxId : normalizeSearchValue(patch.mailboxId),
});

export const useMailboxRouteSearch = () => {
  const navigate = useNavigate({
    from: "/",
  });
  const {
    chatId,
    mailbox: activeMailbox,
    mailboxId,
    messageId,
    query,
    view,
  } = inboxRouteApi.useSearch();
  const inboxStateRef = useRef<InboxRouteState>({
    mailbox: activeMailbox,
    mailboxId,
    messageId,
    query,
  });
  const chatStateRef = useRef<ChatRouteState>({
    chatId,
    mailboxId,
  });

  const setMailboxSearch = (
    patch: MailboxSearchPatch,
    { replace = true }: MailboxSearchOptions = {},
  ) => {
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
          query: nextInboxState.query,
          view: "inbox",
        } as MailboxSearch;
      },
      to: ".",
    });
  };

  return {
    activeMailbox,
    chatId,
    mailboxId,
    messageId,
    query,
    setMailboxSearch,
    view,
  };
};
