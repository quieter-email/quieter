"use client";

import { useNavigate } from "@tanstack/react-router";
import type { MailboxWorkspaceView } from "~/features/mailbox/domain/mailbox-workspace-view";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { MailboxSearch } from "~/routes/index";
import { inboxRouteApi } from "~/lib/route-apis";

type MailboxSearchPatch = {
  mailbox?: MailboxCategory;
  mailboxId?: string | null;
  messageId?: string | null;
  query?: string | null;
  view?: MailboxWorkspaceView;
};

type MailboxSearchOptions = {
  replace?: boolean;
};

const mergeMailboxSearch = (previous: MailboxSearch, patch: MailboxSearchPatch): MailboxSearch => ({
  mailbox: patch.mailbox ?? previous.mailbox,
  mailboxId:
    patch.mailboxId === undefined
      ? previous.mailboxId
      : patch.mailboxId === null
        ? undefined
        : patch.mailboxId.trim() || undefined,
  messageId:
    patch.messageId === undefined
      ? previous.messageId
      : patch.messageId === null
        ? undefined
        : patch.messageId.trim() || undefined,
  query:
    patch.query === undefined ? previous.query : patch.query === null ? "" : patch.query.trim(),
  view: patch.view ?? previous.view,
});

export const useMailboxRouteSearch = () => {
  const navigate = useNavigate({
    from: "/",
  });
  const { mailbox: activeMailbox, mailboxId, messageId, query, view } = inboxRouteApi.useSearch();

  const setMailboxSearch = (
    patch: MailboxSearchPatch,
    { replace = true }: MailboxSearchOptions = {},
  ) => {
    return navigate({
      replace,
      resetScroll: false,
      search: (previous) => mergeMailboxSearch(previous, patch),
      to: ".",
    });
  };

  return {
    activeMailbox,
    mailboxId,
    messageId,
    query,
    setMailboxSearch,
    view,
  };
};
