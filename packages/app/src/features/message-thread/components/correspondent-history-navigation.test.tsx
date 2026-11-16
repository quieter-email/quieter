// @vitest-environment jsdom
import { createMailboxActionHandlers } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { MailboxMessagesPanel } from "@quieter/app/features/mailbox/components/mailbox-workspace/mailbox-messages-panel";
import { useMailboxListController } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-list-controller";
import { MessageDetail } from "@quieter/app/features/message-thread/components/message-detail";
import { inboxRouteApi } from "@quieter/app/lib/route-apis";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import type { ComponentProps, PropsWithChildren } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock(
  import("@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-list-controller"),
  () => ({ useMailboxListController: vi.fn<typeof useMailboxListController>() })
);
vi.mock(
  import("@quieter/app/features/mailbox/components/recent-conversations-provider"),
  () => ({ useRecordRecentConversation: vi.fn<() => undefined>() })
);
vi.mock(
  import("@quieter/app/features/message-thread/components/message-detail"),
  () => ({ MessageDetail: vi.fn<typeof MessageDetail>(() => <span />) })
);
vi.mock(
  import("@quieter/app/features/message-list/components/message-list"),
  () => ({ MessageList: () => <span /> })
);
vi.mock(
  import("@quieter/app/features/mailbox/components/mailbox-idle-state"),
  () => ({
    MailboxIdleState: () => <span />,
  })
);
vi.mock(import("@quieter/app/features/reminders/reminder-due-strip"), () => ({
  ReminderDueStrip: () => null,
}));
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: vi.fn<(error: unknown) => void>(),
}));
vi.mock(import("@quieter/ui/action-footer"), () => ({
  ActionFooter: () => <div />,
}));
vi.mock(import("@quieter/ui/button"), () => ({ Button: () => <span /> }));
vi.mock(import("@quieter/ui/workspace-section"), () => ({
  WorkspaceSection: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

type DetailProps = ComponentProps<typeof MessageDetail>;
type Controller = ReturnType<typeof useMailboxListController>;
type Search = ReturnType<typeof mailboxSearchSchema.parse>;
type Target = Parameters<NonNullable<DetailProps["onOpenConversation"]>>[0];

const initialSearch = {
  calendarConnectionId: "calendar-connection",
  calendarDate: "2026-11-16",
  calendarEventId: "calendar-event",
  calendarId: "calendar",
  calendarTimeZone: "Etc/UTC",
  calendarView: "week",
  chatId: "stale-chat",
  compose: "mailto",
  mailbox: "done",
  mailboxId: "origin-mailbox",
  mailto: "mailto:fixture@example.invalid",
  messageId: "origin-message",
  query: "old search",
  reminderId: "stale-reminder",
  threadId: "origin-thread",
  view: "all-inboxes",
  workspace: "calendar",
} satisfies Search;
const contextFields = [
  "calendarConnectionId",
  "calendarDate",
  "calendarEventId",
  "calendarId",
  "calendarTimeZone",
  "calendarView",
  "chatId",
  "compose",
  "mailto",
  "reminderId",
  "workspace",
] satisfies (keyof Search)[];
const target: Target = {
  mailboxId: "destination-mailbox",
  messageId: "destination-message",
  threadId: "destination-thread",
};

const Panel = () => {
  const search = inboxRouteApi.useSearch();
  return (
    <MailboxMessagesPanel
      activeMailbox="done"
      currentUserEmail="fixture@example.invalid"
      detailOnly
      isDemoMode={false}
      isManagedDemoMode={false}
      mailboxId={search.mailboxId ?? "origin-mailbox"}
      mailboxProvider="gmail"
      mailLayout="two-panels"
      onComposeDraftRequested={() => {}}
      onManageSnippets={() => {}}
      onOpenSidebar={() => {}}
      onSearchQueryChange={() => {}}
      persistComposeDrafts={false}
      searchQuery={search.query}
    />
  );
};

const readDetail = () => {
  const props = vi.mocked(MessageDetail).mock.calls.at(-1)?.[0];
  if (!props?.onOpenConversation) {
    throw new Error(
      "The mailbox panel did not expose conversation navigation."
    );
  }
  return { ...props, onOpenConversation: props.onOpenConversation };
};

const cleanups: (() => void)[] = [];
const mount = async ({
  pendingMessageId,
}: { pendingMessageId?: string } = {}) => {
  const entered = Promise.withResolvers<boolean>();
  const release = Promise.withResolvers<boolean>();
  const rootRoute = createRootRoute();
  const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app" });
  // oxlint-disable eslint/sort-keys -- TanStack infers loader types from preceding route options.
  const inboxRoute = createRoute({
    component: Panel,
    getParentRoute: () => appRoute,
    path: "/",
    validateSearch: (search) => mailboxSearchSchema.parse(search),
    loaderDeps: ({ search }) => ({
      messageId: search.messageId,
      query: search.query,
    }),
    loader: async ({ deps }) => {
      if (
        pendingMessageId &&
        deps.messageId === pendingMessageId &&
        deps.query === ""
      ) {
        entered.resolve(true);
        await release.promise;
      }
    },
  });
  // oxlint-enable eslint/sort-keys
  const history = createMemoryHistory({
    initialEntries: [`/?${new URLSearchParams(initialSearch)}`],
  });
  const router = createRouter({
    defaultPendingMinMs: 0,
    history,
    routeTree: rootRoute.addChildren([appRoute.addChildren([inboxRoute])]),
  });
  const client = new QueryClient();
  const selections: { messageId: string; search: Search }[] = [];
  const activateListMessage = vi.fn<Controller["activateListMessage"]>(
    (messageId) => {
      selections.push({
        messageId,
        search: mailboxSearchSchema.parse(router.state.location.search),
      });
    }
  );
  vi.mocked(useMailboxListController).mockImplementation(
    ({ messageId, threadId }) => ({
      activateListMessage,
      fetchNextPage: vi.fn<Controller["fetchNextPage"]>(),
      flattenedMessages: [],
      hasMessagePages: false,
      isLoadingEmptyMessages: false,
      isRefreshing: false,
      listState: {
        error: null,
        hasNextPage: false,
        isError: false,
        isFetchingNextPage: false,
        isPending: false,
        isRefreshing: false,
        messages: [],
      },
      loadMoreMessages: vi.fn<Controller["loadMoreMessages"]>(),
      mailboxActions: createMailboxActionHandlers({
        activeMailbox: "done",
        activeSearchQuery: "",
        isMessageActionPending: () => false,
        isThreadActionPending: () => false,
        mailboxId: "origin-mailbox",
        queryClient: client,
        refreshSearchResultsIfNeeded:
          vi.fn<Controller["refreshSearchResultsIfNeeded"]>(),
        setMessageActionPending: () => {},
        setMessageActionsPending: () => {},
        setThreadActionPending: () => {},
        setThreadActionsPending: () => {},
        unsubscribeFromMessageMutation: vi.fn<() => Promise<boolean>>(),
      }),
      messagesPending: false,
      paginationMessages: [],
      pendingActions: {
        isMessageActionPending: () => false,
        isThreadActionPending: () => false,
      },
      rawPages: [],
      refreshMessages: vi.fn<Controller["refreshMessages"]>(),
      refreshSearchResultsIfNeeded:
        vi.fn<Controller["refreshSearchResultsIfNeeded"]>(),
      refreshSelectedThread: vi.fn<Controller["refreshSelectedThread"]>(),
      resetListSelection: vi.fn<Controller["resetListSelection"]>(),
      retainedMessageId: null,
      selectedMessage: {
        id: messageId ?? initialSearch.messageId,
        threadId: threadId ?? initialSearch.threadId,
      },
      selectedThreadError: null,
      selectedThreadMessages: [],
      syncError: null,
    })
  );
  const container = document.createElement("div");
  const root = createRoot(container);
  cleanups.push(() => {
    release.resolve(true);
    act(() => {
      root.unmount();
    });
    history.destroy();
    client.clear();
    container.remove();
  });
  await act(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    await router.load();
    root.render(<RouterProvider router={router} />);
  });
  return { entered, release, router, selections };
};

describe("correspondent history destination navigation", () => {
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
      cleanup();
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test.for([
    target,
    {
      mailboxId: initialSearch.mailboxId,
      messageId: initialSearch.messageId,
      threadId: initialSearch.threadId,
    },
  ])(
    "settles the all-inboxes destination before requesting selection and focus, %o",
    async (destination) => {
      const { entered, release, router, selections } = await mount({
        pendingMessageId: destination.messageId,
      });
      const detail = readDetail();
      expect(detail.focusOnOpen).toBeFalsy();
      await act(async () => {
        const opening = detail.onOpenConversation(destination);
        await entered.promise;
        expect(selections).toHaveLength(0);
        expect(readDetail().focusOnOpen).toBeFalsy();
        release.resolve(true);
        await opening;
      });
      const settledSearch = mailboxSearchSchema.parse(
        router.state.location.search
      );
      expect(settledSearch).toMatchObject({
        ...destination,
        mailbox: "done",
        query: "",
        view: "all-inboxes",
      });
      expect(
        contextFields.filter((field) => settledSearch[field] !== undefined)
      ).toHaveLength(0);
      expect(selections).toHaveLength(1);
      expect(selections).toMatchObject([
        {
          messageId: destination.messageId,
          search: {
            ...destination,
            mailbox: "done",
            query: "",
            view: "all-inboxes",
          },
        },
      ]);
      expect(
        selections.flatMap(({ search }) =>
          contextFields.filter((field) => search[field] !== undefined)
        )
      ).toHaveLength(0);
      expect(readDetail()).toMatchObject({
        focusOnOpen: true,
        mailboxId: destination.mailboxId,
        selectedMessage: {
          id: destination.messageId,
          threadId: destination.threadId,
        },
      });
    }
  );

  test("reports a canceled navigation without enabling destination selection or focus", async () => {
    const { router, selections } = await mount();
    vi.spyOn(router, "navigate").mockResolvedValueOnce();
    await act(async () => {
      await expect(
        readDetail().onOpenConversation(target)
      ).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });
    expect(router.state.location.search).toMatchObject(initialSearch);
    expect(selections).toHaveLength(0);
    expect(readDetail().focusOnOpen).toBeFalsy();
  });

  test("propagates a rejected navigation without enabling destination selection or focus", async () => {
    const { router, selections } = await mount();
    const failure = new Error("Navigation rejected");
    vi.spyOn(router, "navigate").mockRejectedValueOnce(failure);
    await act(async () => {
      await expect(readDetail().onOpenConversation(target)).rejects.toBe(
        failure
      );
    });
    expect(selections).toHaveLength(0);
    expect(readDetail().focusOnOpen).toBeFalsy();
  });

  test("rejects the stale target when another route supersedes a pending navigation", async () => {
    const { entered, release, router, selections } = await mount({
      pendingMessageId: target.messageId,
    });
    await act(async () => {
      const outcome = Promise.allSettled([
        readDetail().onOpenConversation(target),
      ]);
      await entered.promise;
      expect(selections).toHaveLength(0);
      await router.navigate({
        search: {
          mailbox: "done",
          mailboxId: "later-mailbox",
          messageId: "later-message",
          threadId: "later-thread",
          view: "all-inboxes",
        },
        to: "/",
      });
      await expect(outcome).resolves.toMatchObject([
        { reason: { code: "CONFLICT" }, status: "rejected" },
      ]);
      release.resolve(true);
    });
    expect(router.state.location.search).toMatchObject({
      mailboxId: "later-mailbox",
      messageId: "later-message",
      threadId: "later-thread",
    });
    expect(selections).toHaveLength(0);
    expect(readDetail().focusOnOpen).toBeFalsy();
  });
});
