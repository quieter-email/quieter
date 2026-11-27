import { readUnifiedInboxPreferences } from "@quieter/app/features/mailbox/domain/unified-inbox";
import type { SettingsTab } from "@quieter/app/features/settings/domain/settings-tab";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import type { QueryClient } from "@tanstack/react-query";
import { defaultParseSearch } from "@tanstack/react-router";
import type { AnyRoute, AnyRouter } from "@tanstack/react-router";

import { subscribeQuerySessionInvalidation } from "./query-persister";

const COMPOSE_SNIPPETS_STALE_MS = 60_000;
const WARM_INBOX_MAILBOX_LIMIT = 6;

const loadRouteChunkByPath = async (router: AnyRouter, path: string) => {
  const routesByPath: Partial<Record<string, AnyRoute>> = router.routesByPath;
  const route = routesByPath[path];
  if (route !== undefined) {
    await router.loadRouteChunk(route);
  }
};

export const warmSettingsDestination = async ({
  isSandboxMode = false,
  queryClient,
  router,
  signal,
  tab,
}: {
  isSandboxMode?: boolean;
  queryClient: QueryClient;
  router: AnyRouter;
  signal?: AbortSignal;
  tab?: SettingsTab;
}) => {
  const {
    loadPreferenceSettingsPanels,
    loadSettingsTabPanel,
    prefetchSettingsOverview,
    prefetchSettingsTab,
  } =
    await import("@quieter/app/features/settings/components/settings-prefetch");
  if (signal?.aborted ?? false) {
    return;
  }
  await Promise.allSettled([
    loadRouteChunkByPath(router, "/settings"),
    tab ? loadSettingsTabPanel(tab) : loadPreferenceSettingsPanels(),
    isSandboxMode ? undefined : prefetchSettingsOverview(queryClient),
    !isSandboxMode && tab ? prefetchSettingsTab(queryClient, tab) : undefined,
  ]);
};

export const warmComposeDestination = async ({
  isSandboxMode = false,
  mailboxId,
  queryClient,
  signal,
}: {
  isSandboxMode?: boolean;
  mailboxId?: string | null;
  queryClient: QueryClient;
  signal?: AbortSignal;
}) => {
  const [{ loadComposeWorkspace }, { orpc }] = await Promise.all([
    import("@quieter/app/features/mailbox/components/mailbox-workspace/workspace-component-loaders"),
    import("@quieter/app/lib/orpc"),
  ]);
  if (signal?.aborted ?? false) {
    return;
  }
  const canWarmSnippets =
    !isSandboxMode &&
    typeof mailboxId === "string" &&
    mailboxId.length > 0 &&
    !isSandboxMailboxId(mailboxId);
  await Promise.allSettled([
    loadComposeWorkspace(),
    canWarmSnippets
      ? queryClient.query(
          orpc.mailSnippets.list.queryOptions({
            input: { mailboxId },
            staleTime: COMPOSE_SNIPPETS_STALE_MS,
          })
        )
      : undefined,
  ]);
};

export const warmCalendarDestination = async ({
  isSandboxMode = false,
  prefetchEvents = false,
  queryClient,
  route,
  signal,
  userId,
}: {
  isSandboxMode?: boolean;
  prefetchEvents?: boolean;
  queryClient: QueryClient;
  route?: ReturnType<typeof mailboxSearchSchema.parse>;
  signal?: AbortSignal;
  userId?: string | null;
}) => {
  const [{ loadCalendarWorkspace }, { calendarAccountsQueryOptions }] =
    await Promise.all([
      import("@quieter/app/features/mailbox/components/mailbox-workspace/workspace-component-loaders"),
      import("@quieter/app/lib/calendar-query"),
    ]);
  if (signal?.aborted ?? false) {
    return;
  }
  const canWarmData =
    !isSandboxMode &&
    typeof userId === "string" &&
    userId.length > 0 &&
    userId !== "preview";
  if (prefetchEvents && canWarmData && route && signal) {
    const { prefetchCalendarWorkspace } = await loadCalendarWorkspace();
    if (!signal.aborted) {
      await prefetchCalendarWorkspace(queryClient, {
        route,
        signal,
        userId,
      });
    }
    return;
  }
  await Promise.allSettled([
    loadCalendarWorkspace(),
    canWarmData
      ? queryClient.query(calendarAccountsQueryOptions(userId))
      : undefined,
  ]);
};

export const warmInboxDestination = async ({
  from = "/",
  isSandboxMode = false,
  queryClient,
  router,
  signal,
  userId,
}: {
  from?: string;
  isSandboxMode?: boolean;
  queryClient: QueryClient;
  router: AnyRouter;
  signal?: AbortSignal;
  userId?: string | null;
}) => {
  const chunkPromise = loadRouteChunkByPath(router, "/");
  if (isSandboxMode || (signal?.aborted ?? false)) {
    await Promise.allSettled([chunkPromise]);
    return;
  }
  let route = mailboxSearchSchema.parse({});
  if (typeof window !== "undefined") {
    try {
      const returnUrl = new URL(from, window.location.origin);
      if (
        returnUrl.origin === window.location.origin &&
        returnUrl.pathname === "/"
      ) {
        route = mailboxSearchSchema.parse(defaultParseSearch(returnUrl.search));
      }
    } catch {
      route = mailboxSearchSchema.parse({});
    }
  }
  if (route.workspace === "calendar") {
    await Promise.allSettled([
      chunkPromise,
      warmCalendarDestination({
        isSandboxMode,
        prefetchEvents: signal !== undefined,
        queryClient,
        route,
        signal,
        userId,
      }),
    ]);
    return;
  }
  const [
    { gmailUnreadCountsQueryOptions, mailboxesQueryOptions },
    { labelsQueryOptions },
    { labelOrganizationQueryOptions },
    { managedLabelCountsQueryOptions },
    { messagesQueryOptions },
  ] = await Promise.all([
    import("@quieter/app/lib/mailboxes-query"),
    import("@quieter/app/lib/mail/labels-query"),
    import("@quieter/app/lib/mail/label-organization-query"),
    import("@quieter/app/lib/managed-mailbox-organization-query"),
    import("@quieter/app/lib/mail/inbox-query/sync"),
  ]);
  if (signal?.aborted ?? false) {
    return;
  }
  const mailboxesOptions = mailboxesQueryOptions();
  let mailboxesData = queryClient.getQueryData(mailboxesOptions.queryKey);
  if (!mailboxesData) {
    try {
      mailboxesData = await queryClient.query(mailboxesOptions);
    } catch {
      await Promise.allSettled([chunkPromise]);
      return;
    }
  }
  if (signal?.aborted ?? false) {
    await Promise.allSettled([chunkPromise]);
    return;
  }
  const mailboxes = mailboxesData.groups.flatMap((group) => group.mailboxes);
  const hasGmail = mailboxes.some((mailbox) => mailbox.provider === "gmail");
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === route.mailboxId) ??
    mailboxes.find(
      (mailbox) => mailbox.id === mailboxesData.defaultMailboxId
    ) ??
    mailboxes[0];
  const opensDefaultMailbox =
    route.view === undefined &&
    route.mailboxId === undefined &&
    route.mailbox === "inbox" &&
    !route.chatId &&
    !route.compose &&
    !route.mailto &&
    !route.messageId &&
    !route.threadId &&
    route.query === "";
  const allInboxes =
    route.view === "all-inboxes" ||
    (opensDefaultMailbox &&
      mailboxesData.defaultMailboxId === null &&
      mailboxes.some((mailbox) => mailbox.provider !== "api"));
  const excludedIds =
    allInboxes && userId
      ? new Set(readUnifiedInboxPreferences(userId).excludedIds)
      : new Set<string>();
  const singleMailboxTargets =
    selectedMailbox?.connectionStatus === "connected" ? [selectedMailbox] : [];
  const targets = allInboxes
    ? mailboxes
        .filter(
          (mailbox) =>
            mailbox.connectionStatus === "connected" &&
            mailbox.provider !== "api" &&
            !excludedIds.has(mailbox.id)
        )
        .slice(0, WARM_INBOX_MAILBOX_LIMIT)
    : singleMailboxTargets;
  const activeCategory =
    route.mailbox === "compose" || route.mailbox === "snippets"
      ? "inbox"
      : route.mailbox;
  const tasks: Promise<unknown>[] = [chunkPromise];
  if (hasGmail) {
    tasks.push(queryClient.query(gmailUnreadCountsQueryOptions()));
  }
  for (const mailbox of targets) {
    if (mailbox.provider !== "api") {
      tasks.push(
        queryClient.query(labelsQueryOptions(mailbox.id)),
        queryClient.query(labelOrganizationQueryOptions(mailbox.id))
      );
    }
    if (mailbox.provider === "managed") {
      tasks.push(queryClient.query(managedLabelCountsQueryOptions(mailbox.id)));
    }
    const category = mailbox.provider === "api" ? "sent" : activeCategory;
    if (route.query === "") {
      const listOptions = messagesQueryOptions(mailbox.id, category);
      if (queryClient.getQueryData(listOptions.queryKey) === undefined) {
        tasks.push(queryClient.infiniteQuery(listOptions));
      }
    }
  }
  await Promise.allSettled(tasks);
};

export const canPrefetchInBackground = () => {
  if (document.visibilityState !== "visible" || !navigator.onLine) {
    return false;
  }
  const connection = "connection" in navigator ? navigator.connection : null;
  return !(
    typeof connection === "object" &&
    connection !== null &&
    (("saveData" in connection && connection.saveData === true) ||
      ("effectiveType" in connection &&
        (connection.effectiveType === "slow-2g" ||
          connection.effectiveType === "2g")))
  );
};

export const hasForegroundWorkspaceFetches = (queryClient: QueryClient) =>
  queryClient.isFetching({
    predicate: ({ queryKey }) =>
      queryKey[0] === "messages" ||
      queryKey[0] === "message-thread" ||
      queryKey[0] === "calendar",
    type: "active",
  }) > 0;

export const scheduleBackgroundPrefetch = (
  queryClient: QueryClient,
  run: (signal: AbortSignal) => Promise<void>
) => {
  const controller = new AbortController();
  const unsubscribe = subscribeQuerySessionInvalidation(queryClient, () => {
    controller.abort();
  });
  let ready = false;
  let started = false;
  const start = () => {
    if (
      ready &&
      !controller.signal.aborted &&
      !started &&
      canPrefetchInBackground() &&
      !hasForegroundWorkspaceFetches(queryClient)
    ) {
      started = true;
      void Promise.allSettled([run(controller.signal)]);
    }
  };
  const timer = window.setTimeout(() => {
    ready = true;
    start();
  }, 350);
  const unsubscribeQueries = queryClient.getQueryCache().subscribe(start);
  const connection = "connection" in navigator ? navigator.connection : null;
  if (connection instanceof EventTarget) {
    connection.addEventListener("change", start);
  }
  window.addEventListener("online", start);
  document.addEventListener("visibilitychange", start);
  return () => {
    controller.abort();
    unsubscribe();
    unsubscribeQueries();
    if (connection instanceof EventTarget) {
      connection.removeEventListener("change", start);
    }
    window.clearTimeout(timer);
    window.removeEventListener("online", start);
    document.removeEventListener("visibilitychange", start);
  };
};
