"use client";

import type { MailboxWorkspaceView } from "@quieter/app/features/mailbox/domain/mailbox-workspace-view";
import { inboxRouteApi } from "@quieter/app/lib/route-apis";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import type { CalendarView } from "@quieter/calendar";
import { useNavigate } from "@tanstack/react-router";

const MAILBOX_ROUTE_CATEGORIES = [
  "inbox",
  "important",
  "unread",
  "archive",
  "spam",
  "sent",
  "trash",
  "drafts",
  "snippets",
  "compose",
] as const;

type MailboxRouteCategory = (typeof MAILBOX_ROUTE_CATEGORIES)[number];

export type MailboxSearchPatch = {
  calendarConnectionId?: string | null;
  calendarDate?: string | null;
  calendarEventId?: string | null;
  calendarId?: string | null;
  calendarTimeZone?: string | null;
  calendarView?: CalendarView | null;
  chatId?: string | null;
  compose?: "mailto" | null;
  mailto?: string | null;
  mailbox?: MailboxRouteCategory;
  mailboxId?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  query?: string | null;
  view?: MailboxWorkspaceView;
  workspace?: "calendar" | null;
};

type MailboxSearchOptions = {
  replace?: boolean;
};

export type MailboxRouteState = {
  calendarConnectionId?: string;
  calendarDate?: string;
  calendarEventId?: string;
  calendarId?: string;
  calendarTimeZone?: string;
  calendarView?: CalendarView;
  chatId?: string;
  compose?: "mailto";
  mailbox: MailboxRouteCategory;
  mailboxId?: string;
  mailto?: string;
  messageId?: string;
  query: string;
  threadId?: string;
  view?: MailboxWorkspaceView;
  workspace?: "calendar";
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

  const next: MailboxRouteState = {
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
  for (const field of [
    "calendarConnectionId",
    "calendarDate",
    "calendarEventId",
    "calendarId",
    "calendarTimeZone",
  ] as const) {
    const value =
      patch[field] === undefined
        ? state[field]
        : normalizeSearchValue(patch[field]);
    if (value !== undefined) {
      next[field] = value;
    }
  }
  const calendarView =
    patch.calendarView === undefined ? state.calendarView : patch.calendarView;
  if (calendarView) {
    next.calendarView = calendarView;
  }
  const workspace =
    patch.workspace === undefined ? state.workspace : patch.workspace;
  if (workspace) {
    next.workspace = workspace;
  }
  return next;
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
      search: (previous) =>
        applyMailboxSearchPatch(mailboxSearchSchema.parse(previous), patch),
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

export const useMailWorkspaceRouteSearch = () => {
  const workspace = inboxRouteApi.useSearch({
    select: (search) => search.workspace,
  });
  const routeMailbox = inboxRouteApi.useSearch({
    select: (search) => search.mailbox,
  });
  const isSnippetMailbox = routeMailbox === "snippets";
  const isComposeMailbox = routeMailbox === "compose";
  const activeMailbox =
    routeMailbox === "snippets" || routeMailbox === "compose"
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
    isSnippetMailbox,
    mailboxId,
    mailto,
    messageId,
    opensDefaultMailbox:
      view === undefined &&
      mailboxId === undefined &&
      routeMailbox === "inbox" &&
      !chatId &&
      !compose &&
      !mailto &&
      !messageId &&
      !threadId &&
      !query,
    query,
    setMailboxSearch,
    threadId,
    view: view ?? "inbox",
    workspace,
  };
};

export const useMailboxRouteSearch = () => {
  const mailSearch = useMailWorkspaceRouteSearch();
  const calendarSearch = inboxRouteApi.useSearch({
    select: (search) => ({
      calendarConnectionId: search.calendarConnectionId,
      calendarDate: search.calendarDate,
      calendarEventId: search.calendarEventId,
      calendarId: search.calendarId,
      calendarTimeZone: search.calendarTimeZone,
      calendarView: search.calendarView,
    }),
    structuralSharing: true,
  });
  return { ...mailSearch, ...calendarSearch };
};
