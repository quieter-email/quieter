// @vitest-environment jsdom
import { createMailboxActionHandlers } from "@quieter/app/features/mailbox/components/mailbox-action-handlers";
import { MailboxMessagesPanel } from "@quieter/app/features/mailbox/components/mailbox-workspace/mailbox-messages-panel";
import { useMailboxListController } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-list-controller";
import { useMailboxNavigationBlocker } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { MessageDetail } from "@quieter/app/features/message-thread/components/message-detail";
import { inboxRouteApi } from "@quieter/app/lib/route-apis";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import { QueryClient } from "@tanstack/react-query";
import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, useState } from "react";
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
type Guard = Parameters<typeof useMailboxNavigationBlocker>[0]["shouldBlockFn"];

const NavigationGuard = ({
  guard,
  beforeUnload,
}: {
  guard: Guard;
  beforeUnload?: () => boolean;
}) => {
  const [, update] = useState(0);
  useMailboxNavigationBlocker({
    enableBeforeUnload: beforeUnload,
    shouldBlockFn: async (args) => {
      update((value) => value + 1);
      return await guard(args);
    },
  });
  return null;
};

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
  guard,
  beforeUnload,
}: {
  pendingMessageId?: string;
  guard?: Guard;
  beforeUnload?: () => boolean;
} = {}) => {
  const entered = Promise.withResolvers<boolean>();
  const release = Promise.withResolvers<boolean>();
  const rootRoute = createRootRoute();
  const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app" });
  // oxlint-disable eslint/sort-keys -- TanStack infers loader types from preceding route options.
  const inboxRoute = createRoute({
    component: () => (
      <>
        {guard && <NavigationGuard beforeUnload={beforeUnload} guard={guard} />}
        <Panel />
      </>
    ),
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
  const initialHref = `/?${new URLSearchParams(initialSearch)}`;
  if (guard) {
    window.history.replaceState(null, "", initialHref);
  }
  const history = guard
    ? createBrowserHistory()
    : createMemoryHistory({
        initialEntries: [initialHref],
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
    if (guard) {
      window.history.replaceState(null, "", "/");
    }
    client.clear();
    container.remove();
  });
  await act(async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    await router.load();
    root.render(<RouterProvider router={router} />);
  });
  return {
    entered,
    release,
    router,
    selections,
    unmount: () => {
      root.unmount();
    },
  };
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
        const opening = detail.onOpenConversation(destination, {
          signal: new AbortController().signal,
        });
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
      expect(settledSearch.chatId).toBe(
        destination.mailboxId === initialSearch.mailboxId
          ? initialSearch.chatId
          : undefined
      );
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
        readDetail().onOpenConversation(target, {
          signal: new AbortController().signal,
        })
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
      await expect(
        readDetail().onOpenConversation(target, {
          signal: new AbortController().signal,
        })
      ).rejects.toBe(failure);
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
        readDetail().onOpenConversation(target, {
          signal: new AbortController().signal,
        }),
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

  test("settles an actual native block without another navigation", async () => {
    const guard = vi.fn<Guard>().mockResolvedValueOnce(true);
    const { router, selections } = await mount({ guard });
    await act(async () => {
      await expect(
        readDetail().onOpenConversation(target, {
          signal: new AbortController().signal,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    expect(guard).toHaveBeenCalledOnce();
    expect(router.state.location.search).toMatchObject(initialSearch);
    expect(selections).toHaveLength(0);
    expect(readDetail().focusOnOpen).toBeFalsy();
  });

  test("waits for both the real guard and destination loader before focus", async () => {
    const decision = Promise.withResolvers<boolean>();
    const guardEntered = Promise.withResolvers<null>();
    const guard = vi.fn<Guard>(async () => {
      guardEntered.resolve(null);
      return await decision.promise;
    });
    const { entered, release, router, selections } = await mount({
      guard,
      pendingMessageId: target.messageId,
    });
    await act(async () => {
      const opening = readDetail().onOpenConversation(target, {
        signal: new AbortController().signal,
      });
      await guardEntered.promise;
      expect(selections).toHaveLength(0);
      decision.resolve(false);
      await entered.promise;
      expect(selections).toHaveLength(0);
      expect(readDetail().focusOnOpen).toBeFalsy();
      release.resolve(true);
      await opening;
    });
    expect(guard).toHaveBeenCalledOnce();
    expect(guard.mock.calls[0]?.[0].next.search).toMatchObject({
      mailbox: "done",
      mailboxId: target.mailboxId,
      view: "all-inboxes",
    });
    expect(router.state.location.search).toMatchObject(target);
    expect(selections).toHaveLength(1);
    expect(readDetail().focusOnOpen).toBeTruthy();
  });

  test("propagates an actual guard error without committing its destination", async () => {
    const failure = new Error("Fixture save failed");
    const guard = vi.fn<Guard>().mockRejectedValueOnce(failure);
    const { router, selections } = await mount({ guard });
    await act(async () => {
      await expect(
        readDetail().onOpenConversation(target, {
          signal: new AbortController().signal,
        })
      ).rejects.toBe(failure);
    });
    expect(guard).toHaveBeenCalledOnce();
    expect(router.state.location.search).toMatchObject(initialSearch);
    expect(selections).toHaveLength(0);
  });

  test.each(["allow", "error"])(
    "retires a held guard before its late %s result",
    async (late) => {
      const decision = Promise.withResolvers<boolean>();
      const entered = Promise.withResolvers<null>();
      const guard = vi.fn<Guard>(async () => {
        entered.resolve(null);
        return await decision.promise;
      });
      const { router, selections } = await mount({ guard });
      const controller = new AbortController();
      await act(async () => {
        const opening = Promise.allSettled([
          readDetail().onOpenConversation(target, {
            signal: controller.signal,
          }),
        ]);
        await entered.promise;
        controller.abort();
        await expect(opening).resolves.toMatchObject([
          { reason: { name: "AbortError" }, status: "rejected" },
        ]);
        if (late === "allow") {
          decision.resolve(false);
        } else {
          decision.reject(new Error("Late fixture save failed"));
        }
      });
      expect(router.state.location.search).toMatchObject(initialSearch);
      expect(selections).toHaveLength(0);
      expect(readDetail().focusOnOpen).toBeFalsy();
    }
  );

  test("isolates repeated same-target attempts and a late older allow", async () => {
    const oldDecision = Promise.withResolvers<boolean>();
    const oldEntered = Promise.withResolvers<null>();
    const guard = vi
      .fn<Guard>()
      .mockImplementationOnce(async () => {
        oldEntered.resolve(null);
        return await oldDecision.promise;
      })
      .mockResolvedValueOnce(false);
    const { router, selections } = await mount({ guard });
    await act(async () => {
      const oldOpening = Promise.allSettled([
        readDetail().onOpenConversation(target, {
          signal: new AbortController().signal,
        }),
      ]);
      await oldEntered.promise;
      const current = readDetail().onOpenConversation(target, {
        signal: new AbortController().signal,
      });
      await expect(oldOpening).resolves.toMatchObject([
        { reason: { code: "CONFLICT" }, status: "rejected" },
      ]);
      await current;
      oldDecision.resolve(false);
    });
    expect(guard).toHaveBeenCalledTimes(2);
    expect(router.state.location.search).toMatchObject(target);
    expect(window.location.search).toContain(target.messageId);
    expect(selections).toHaveLength(1);
    expect(readDetail().focusOnOpen).toBeTruthy();
  });

  test("an ordinary native navigation retires an older held attempt", async () => {
    const oldDecision = Promise.withResolvers<boolean>();
    const oldEntered = Promise.withResolvers<null>();
    const guard = vi
      .fn<Guard>()
      .mockImplementationOnce(async () => {
        oldEntered.resolve(null);
        return await oldDecision.promise;
      })
      .mockResolvedValueOnce(false);
    const { router, selections } = await mount({ guard });
    await act(async () => {
      const oldOpening = Promise.allSettled([
        readDetail().onOpenConversation(target, {
          signal: new AbortController().signal,
        }),
      ]);
      await oldEntered.promise;
      await router.navigate({
        search: {
          ...initialSearch,
          messageId: "later-message",
          threadId: "later-thread",
        },
        to: "/",
      });
      await expect(oldOpening).resolves.toMatchObject([{ status: "rejected" }]);
      oldDecision.resolve(false);
    });
    expect(router.state.location.search).toMatchObject({
      messageId: "later-message",
      threadId: "later-thread",
    });
    expect(selections).toHaveLength(0);
  });

  test("disposal retires a held attempt before its guard later allows", async () => {
    const decision = Promise.withResolvers<boolean>();
    const entered = Promise.withResolvers<null>();
    const guard = vi.fn<Guard>(async () => {
      entered.resolve(null);
      return await decision.promise;
    });
    const { router, selections, unmount } = await mount({ guard });
    await act(async () => {
      const opening = Promise.allSettled([
        readDetail().onOpenConversation(target, {
          signal: new AbortController().signal,
        }),
      ]);
      await entered.promise;
      unmount();
      await expect(opening).resolves.toMatchObject([{ status: "rejected" }]);
      decision.resolve(false);
    });
    expect(router.state.location.search).toMatchObject(initialSearch);
    expect(selections).toHaveLength(0);
  });

  test("preserves the existing before-unload predicate", async () => {
    let dirty = true;
    const beforeUnload = vi.fn<() => boolean>(() => dirty);
    const guard = vi.fn<Guard>().mockResolvedValue(false);
    await mount({ beforeUnload, guard });
    const blocked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBeTruthy();
    dirty = false;
    const allowed = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).toBeFalsy();
    expect(guard).not.toHaveBeenCalled();
  });

  test("uses a new native attempt when the settled target is opened again", async () => {
    const guard = vi.fn<Guard>().mockResolvedValue(false);
    const { selections } = await mount({ guard });
    await act(async () => {
      await readDetail().onOpenConversation(target, {
        signal: new AbortController().signal,
      });
    });
    act(() => {
      readDetail().onAutoFocusComplete?.();
    });
    expect(readDetail().focusOnOpen).toBeFalsy();
    await act(async () => {
      await readDetail().onOpenConversation(target, {
        signal: new AbortController().signal,
      });
    });
    expect(guard).toHaveBeenCalledTimes(2);
    expect(selections).toHaveLength(2);
    expect(readDetail().focusOnOpen).toBeTruthy();
  });

  test("an already retired caller cannot cancel the current held attempt", async () => {
    const decision = Promise.withResolvers<boolean>();
    const entered = Promise.withResolvers<null>();
    const guard = vi.fn<Guard>(async () => {
      entered.resolve(null);
      return await decision.promise;
    });
    const { selections } = await mount({ guard });
    await act(async () => {
      const current = Promise.allSettled([
        readDetail().onOpenConversation(target, {
          signal: new AbortController().signal,
        }),
      ]);
      await entered.promise;
      const retired = new AbortController();
      retired.abort();
      await expect(
        readDetail().onOpenConversation(target, { signal: retired.signal })
      ).rejects.toMatchObject({ name: "AbortError" });
      decision.resolve(false);
      await expect(current).resolves.toMatchObject([{ status: "fulfilled" }]);
    });
    expect(guard).toHaveBeenCalledOnce();
    expect(selections).toHaveLength(1);
  });

  test("allows back traversal to a completed tagged entry through the ordinary guard", async () => {
    const guard = vi.fn<Guard>().mockResolvedValue(false);
    const { router, selections } = await mount({ guard });
    await act(async () => {
      await readDetail().onOpenConversation(target, {
        signal: new AbortController().signal,
      });
      await router.navigate({
        search: { ...initialSearch, messageId: "later-message" },
        to: "/",
      });
    });
    const returned = Promise.withResolvers<null>();
    const unsubscribe = router.subscribe("onResolved", (event) => {
      if (
        mailboxSearchSchema.parse(event.toLocation.search).messageId ===
        target.messageId
      ) {
        returned.resolve(null);
      }
    });
    try {
      await act(async () => {
        router.history.back();
        await returned.promise;
      });
    } finally {
      unsubscribe();
    }
    expect(router.state.location.search).toMatchObject(target);
    expect(guard).toHaveBeenCalledTimes(3);
    expect(selections).toHaveLength(1);
  });
});
