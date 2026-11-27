"use client";

import { ORPCError } from "@orpc/client";
import type { MailboxWorkspaceView } from "@quieter/app/features/mailbox/domain/mailbox-workspace-view";
import { isExpectedClientError } from "@quieter/app/lib/client-error-reporting";
import { toastError } from "@quieter/app/lib/error-toast";
import { inboxRouteApi } from "@quieter/app/lib/route-apis";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import type { CalendarView } from "@quieter/calendar";
import { serializeStructuredSearchState } from "@quieter/mail/search";
import { captureException } from "@sentry/react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type {
  AnyRouter,
  HistoryLocation,
  HistoryState,
  UseBlockerOpts,
} from "@tanstack/react-router";
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { z } from "zod";

const navigationStateSchema = z.object({ quieterNavigationAttempt: z.uuid() });
type NavigationHistoryState = HistoryState &
  z.infer<typeof navigationStateSchema>;
type NavigationAttempt = {
  id: string;
  controller: AbortController;
  stop: (error: unknown) => void;
};
const navigationAttempts = new WeakMap<AnyRouter, NavigationAttempt>();
type NavigationGuardLocation = {
  pathname: string;
  search: Record<string, unknown>;
};
type NavigationGuardArgs = Omit<
  Parameters<UseBlockerOpts["shouldBlockFn"]>[0],
  "current" | "next"
> & { current: NavigationGuardLocation; next: NavigationGuardLocation };

export const useMailboxNavigationBlocker = ({
  enableBeforeUnload = true,
  shouldBlockFn,
}: {
  enableBeforeUnload?: UseBlockerOpts["enableBeforeUnload"];
  shouldBlockFn: (
    args: NavigationGuardArgs
  ) => ReturnType<UseBlockerOpts["shouldBlockFn"]>;
}) => {
  const router = useRouter();
  const decide = useEffectEvent(shouldBlockFn);
  const beforeUnload = useEffectEvent(() =>
    typeof enableBeforeUnload === "function"
      ? enableBeforeUnload()
      : enableBeforeUnload
  );

  useEffect(() => {
    const pending = new Set<NavigationAttempt>();
    const readLocation = (location: HistoryLocation) => {
      const parsed = router.parseLocation(location);
      const [, params, route] = router.getMatchedRoutes(parsed.pathname);
      const fullPath: unknown = route?.fullPath;
      const routeId: unknown = route?.id;
      const search: Record<string, unknown> = router.options.parseSearch(
        location.search
      );
      return {
        fullPath: typeof fullPath === "string" ? fullPath : parsed.pathname,
        params,
        pathname: parsed.pathname,
        routeId: typeof routeId === "string" ? routeId : "__notFound__",
        search,
      };
    };
    const unblock = router.history.block({
      blockerFn: async (raw) => {
        const state = navigationStateSchema.safeParse(raw.nextLocation.state);
        const tagged =
          (raw.action === "PUSH" || raw.action === "REPLACE") &&
          "quieterNavigationAttempt" in raw.nextLocation.state;
        const currentAttempt = navigationAttempts.get(router);
        const attempt =
          tagged &&
          state.success &&
          currentAttempt?.id === state.data.quieterNavigationAttempt
            ? currentAttempt
            : undefined;
        if (currentAttempt && currentAttempt !== attempt) {
          currentAttempt.stop(
            new ORPCError("CONFLICT", {
              message: "The conversation did not open. Try again.",
            })
          );
        }
        if (tagged && (!attempt || attempt.controller.signal.aborted)) {
          return true;
        }
        if (attempt) {
          pending.add(attempt);
        }
        const retired = Promise.withResolvers<{ kind: "retired" }>();
        const onRetire = () => {
          retired.resolve({ kind: "retired" });
        };
        attempt?.controller.signal.addEventListener("abort", onRetire, {
          once: true,
        });
        const outcome = (async () => {
          try {
            const current = readLocation(raw.currentLocation);
            const next = readLocation(raw.nextLocation);
            const blocked =
              current.routeId === "__notFound__" &&
              next.routeId !== "__notFound__"
                ? false
                : await decide({ action: raw.action, current, next });
            return { blocked, kind: "decision" } as const;
          } catch (error) {
            if (!attempt) {
              toastError(error, { boundary: "mailbox-navigation" });
            } else if (
              attempt.controller.signal.aborted &&
              !isExpectedClientError(error) &&
              !(error instanceof ORPCError && error.status < 500)
            ) {
              captureException(error, {
                tags: { boundary: "mailbox-navigation" },
              });
            }
            return { error, kind: "failed" } as const;
          }
        })();
        try {
          const result = attempt
            ? await Promise.race([outcome, retired.promise])
            : await outcome;
          if (
            attempt?.controller.signal.aborted === true ||
            result.kind === "retired"
          ) {
            return true;
          }
          if (result.kind === "failed") {
            attempt?.stop(result.error);
            return true;
          }
          if (result.blocked) {
            attempt?.stop(
              new ORPCError("CONFLICT", {
                message:
                  "The conversation did not open. Finish your draft or try again.",
              })
            );
          }
          return result.blocked;
        } finally {
          attempt?.controller.signal.removeEventListener("abort", onRetire);
          if (attempt) {
            pending.delete(attempt);
          }
        }
      },
      enableBeforeUnload: () => beforeUnload(),
    });
    return () => {
      unblock();
      for (const attempt of pending) {
        attempt.stop(
          new ORPCError("CONFLICT", {
            message: "The conversation did not open. Try again.",
          })
        );
      }
    };
  }, [router]);
};

const MAILBOX_ROUTE_CATEGORIES = [
  "inbox",
  "done",
  "later",
  "important",
  "unread",
  "spam",
  "sent",
  "trash",
  "drafts",
  "scheduled",
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
  reminderId?: string | null;
  threadId?: string | null;
  query?: string | null;
  view?: MailboxWorkspaceView;
  workspace?: "calendar" | null;
};

export const getLabelSearchPatch = (
  mailboxId: string,
  labelName: string,
  mailbox: MailboxRouteCategory
): MailboxSearchPatch => ({
  mailbox,
  mailboxId,
  messageId: null,
  query: serializeStructuredSearchState({
    filters: [{ type: "label", value: labelName }],
    text: "",
  }),
  threadId: null,
  view: "inbox",
  workspace: null,
});

type MailboxSearchOptions = {
  replace?: boolean;
  signal?: AbortSignal;
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
  reminderId?: string;
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
    reminderId:
      patch.reminderId === undefined
        ? state.reminderId
        : normalizeSearchValue(patch.reminderId),
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
  const router = useRouter();
  const owned = useRef(new Set<NavigationAttempt>());

  useLayoutEffect(() => {
    const attempts = owned.current;
    return () => {
      for (const attempt of attempts) {
        attempt.stop(
          new ORPCError("CONFLICT", {
            message: "The conversation did not open. Try again.",
          })
        );
      }
    };
  }, [router]);

  return async (
    patch: MailboxSearchPatch,
    { replace = true, signal }: MailboxSearchOptions = {}
  ) => {
    signal?.throwIfAborted();
    navigationAttempts.get(router)?.stop(
      new ORPCError("CONFLICT", {
        message: "The conversation did not open. Try again.",
      })
    );
    const options = {
      replace,
      resetScroll: false,
      search: (previous: unknown) =>
        applyMailboxSearchPatch(mailboxSearchSchema.parse(previous), patch),
      to: "." as const,
    };
    if (!signal) {
      await navigate(options);
      return;
    }
    const completion = Promise.withResolvers<null>();
    const attempt: NavigationAttempt = {
      controller: new AbortController(),
      id: crypto.randomUUID(),
      stop(error) {
        attempt.controller.abort(error);
        completion.reject(error);
      },
    };
    const onAbort = () => {
      attempt.stop(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    navigationAttempts.set(router, attempt);
    owned.current.add(attempt);
    try {
      const state: NavigationHistoryState = {
        quieterNavigationAttempt: attempt.id,
      };
      const navigation = navigate({ ...options, state });
      void (async () => {
        try {
          await navigation;
          completion.resolve(null);
        } catch (error) {
          completion.reject(error);
        }
      })();
      await completion.promise;
      signal.throwIfAborted();
      attempt.controller.signal.throwIfAborted();
    } finally {
      signal.removeEventListener("abort", onAbort);
      owned.current.delete(attempt);
      if (navigationAttempts.get(router) === attempt) {
        navigationAttempts.delete(router);
      }
      attempt.controller.abort();
    }
  };
};

export const useMailSubviewNavigation = () => {
  const search = inboxRouteApi.useSearch();
  const setMailboxSearch = useMailboxSearchActions();
  const lastDestinationSearchRef = useRef<MailboxRouteState | null>(null);
  const isDestination =
    search.workspace === "calendar" ||
    (search.mailbox !== "compose" && search.view !== "labels");

  useLayoutEffect(() => {
    if (isDestination) {
      lastDestinationSearchRef.current = search;
    }
  }, [isDestination, search]);

  return () => {
    const previous = lastDestinationSearchRef.current;
    void setMailboxSearch({
      ...previous,
      chatId:
        previous && previous.mailboxId !== search.mailboxId
          ? (previous.chatId ?? null)
          : undefined,
      compose: null,
      mailbox:
        previous?.mailbox ??
        (search.mailbox === "compose" || search.mailbox === "snippets"
          ? "inbox"
          : search.mailbox),
      mailboxId: previous
        ? (previous.mailboxId ?? null)
        : (search.mailboxId ?? null),
      mailto: null,
      messageId: previous?.messageId ?? null,
      query: previous?.query ?? search.query,
      threadId: previous?.threadId ?? null,
      view: previous?.view ?? "inbox",
      workspace: previous?.workspace ?? null,
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
  const isScheduledMailbox = routeMailbox === "scheduled";
  const activeMailbox =
    routeMailbox === "snippets" ||
    routeMailbox === "compose" ||
    routeMailbox === "scheduled"
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
    isScheduledMailbox,
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
