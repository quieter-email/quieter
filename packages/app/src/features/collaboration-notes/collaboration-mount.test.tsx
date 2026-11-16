// @vitest-environment jsdom
import { setTimeout } from "node:timers/promises";

import { useMailboxListController } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-list-controller";
import { useMailboxSearchActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { MailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type {
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/app/lib/mail";
import type { MessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import { getMessagesQueryKey } from "@quieter/app/lib/mail/inbox-query/keys";
import {
  getThreadQueryKey,
  getThreadWithDetailsOptions,
} from "@quieter/app/lib/mail/thread-query";
import { getMailboxesQueryKey } from "@quieter/app/lib/mailboxes-query";
import type { rpc } from "@quieter/app/lib/orpc";
import { inboxRouteApi } from "@quieter/app/lib/route-apis";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useBlocker,
} from "@tanstack/react-router";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

const server = vi.hoisted(() => ({
  getThread: vi.fn<typeof rpc.mail.getThread>(),
  listThreads: vi.fn<typeof rpc.mail.listThreads>(),
  syncMailbox: vi.fn<typeof rpc.mail.syncMailbox>(),
}));

vi.mock(import("@quieter/app/lib/orpc"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      mail: {
        ...actual.rpc.mail,
        getThread: server.getThread,
        listThreads: server.listThreads,
        syncMailbox: server.syncMailbox,
      },
    },
  };
});
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: vi.fn<() => void>(),
}));

const settle = async () => {
  await act(async () => {
    await setTimeout(0);
  });
};

const fixtures: { dispose: () => void }[] = [];
const mount = async (url: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
  });
  const control: {
    blocked: boolean;
    current?: ReturnType<typeof useMailboxListController>;
    navigate?: ReturnType<typeof useMailboxSearchActions>;
  } = { blocked: false };
  const Probe = () => {
    const search = inboxRouteApi.useSearch();
    const navigate = useMailboxSearchActions();
    const data = useMailboxListController({
      activeMailbox: "inbox",
      isDemoMode: false,
      isManagedDemoMode: false,
      mailboxId: search.mailboxId ?? "shared-a",
      mailboxProvider: "managed",
      messageId: search.messageId ?? null,
      searchQuery: search.query,
      selectionScopeKey: search.view,
      threadId: search.threadId ?? null,
    });
    useLayoutEffect(() => {
      control.current = data;
      control.navigate = navigate;
    });
    useBlocker({
      enableBeforeUnload: false,
      shouldBlockFn: () => control.blocked,
    });
    return <output>{data.selectedMessage?.bodyText ?? ""}</output>;
  };
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({
    component: Outlet,
    getParentRoute: () => rootRoute,
    id: "_app",
  });
  const inboxRoute = createRoute({
    component: Probe,
    getParentRoute: () => appRoute,
    path: "/",
    validateSearch: mailboxSearchSchema,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [url] }),
    routeTree: rootRoute.addChildren([appRoute.addChildren([inboxRoute])]),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  fixtures.push({
    dispose: () => {
      act(() => {
        root.unmount();
      });
      queryClient.clear();
      container.remove();
    },
  });
  await act(async () => {
    await router.load();
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
  const read = () => {
    if (!control.current) {
      throw new Error("Mailbox controller did not mount.");
    }
    return control.current;
  };
  const navigate = async (patch: MailboxSearchPatch) => {
    await act(async () => {
      void control.navigate?.(patch);
      await setTimeout(0);
    });
  };
  await vi.waitFor(async () => {
    await settle();
    expect(control.current).toBeDefined();
  });
  return { container, control, navigate, queryClient, read, router, settle };
};

describe("canonical collaboration destinations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    server.getThread.mockImplementation(async ({ threadId }) => {
      await setTimeout(0);
      return {
        messages: [],
        threadId,
      };
    });
    server.listThreads.mockResolvedValue({ messages: [] });
    server.syncMailbox.mockResolvedValue({
      hasChanges: false,
      refreshFirstPage: false,
      removedMessageIds: [],
      requiresFullRefresh: false,
      updatedMessages: [],
    });
  });
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      fixture.dispose();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("opens an off-folder thread through the complete reader without a message URL", async () => {
    const enriched: MessageListItem = {
      attachments: [
        {
          attachmentId: "file",
          fileName: "brief.pdf",
          mimeType: "application/pdf",
          size: 128,
        },
      ],
      bodyText: "The complete conversation body",
      id: "latest",
      inlineImages: [
        {
          attachmentId: "inline",
          contentId: "logo",
          fileName: "logo.png",
          mimeType: "image/png",
          size: 64,
        },
      ],
      isImportant: true,
      replyTo: "reply@example.test",
      senderAvatarUrls: { dark: "/dark.png", light: "/light.png" },
      threadId: "off-folder",
      threadLabelIds: ["INBOX", "IMPORTANT"],
      unsubscribeStatus: "requested",
    };
    server.listThreads.mockResolvedValue({
      messages: [{ id: "unrelated", threadId: "other" }],
    });
    server.getThread.mockResolvedValue({
      messages: [
        { bodyText: "Earlier", id: "earlier", threadId: "off-folder" },
        enriched,
        { draftId: "draft", id: "draft", threadId: "off-folder" },
      ],
      threadId: "off-folder",
    });
    const app = await mount("/?mailboxId=shared-a&threadId=off-folder");
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.container.textContent).toContain("complete conversation");
    });
    expect(app.read().selectedMessage).toMatchObject(enriched);
    expect(
      app.read().paginationMessages.map((message) => message.id)
    ).toStrictEqual(["unrelated"]);
    expect(app.router.state.location.search).not.toHaveProperty("messageId");
    await app.navigate({ messageId: "latest", threadId: "off-folder" });
    expect(app.read().selectedMessage).toMatchObject(enriched);
  });

  test("uses the existing reader seed for an all-draft thread without navigating to compose", async () => {
    server.getThread.mockResolvedValue({
      messages: [
        {
          bodyText: "Earlier draft",
          draftId: "draft-a",
          id: "a",
          threadId: "drafts-only",
        },
        {
          bodyText: "Latest draft",
          draftId: "draft-b",
          id: "b",
          threadId: "drafts-only",
        },
      ],
      threadId: "drafts-only",
    });
    const app = await mount("/?mailboxId=shared-a&threadId=drafts-only");
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.read().selectedMessage?.id).toBe("b");
    });
    expect(app.router.state.location.search).not.toHaveProperty("compose");
  });

  test("keeps a real ordinary row through list removal and retires it on a terminal denial", async () => {
    const selected: MessageListItem = {
      bodyText: "Selected body",
      id: "selected",
      threadId: "thread",
    };
    server.listThreads.mockResolvedValue({ messages: [selected] });
    server.getThread.mockResolvedValue({
      messages: [selected],
      threadId: "thread",
    });
    const app = await mount(
      "/?mailboxId=shared-a&threadId=thread&messageId=selected"
    );
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.read().selectedMessage?.id).toBe("selected");
    });
    act(() => {
      app.read().activateListMessage("selected");
      app.queryClient.setQueryData<MessagesQueryData>(
        getMessagesQueryKey("shared-a", "inbox"),
        {
          pageParams: [undefined],
          pages: [{ messages: [] }],
        }
      );
    });
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.read().retainedMessageId).toBe("selected");
    });
    server.getThread.mockRejectedValue(
      Object.assign(new Error("Denied"), { code: "FORBIDDEN" })
    );
    await act(async () => {
      await app.queryClient.refetchQueries({
        queryKey: getThreadQueryKey("shared-a", "thread"),
      });
      await setTimeout(0);
    });
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.read().selectedMessage).toBeNull();
    });
    expect(app.read().flattenedMessages).toHaveLength(0);
    expect(app.read().retainedMessageId).toBeNull();
  });

  test("selects the exact ordinary message while ignoring a same-id row in another thread", async () => {
    server.listThreads.mockResolvedValue({
      messages: [
        { bodyText: "Wrong conversation", id: "older", threadId: "wrong" },
      ],
    });
    server.getThread.mockResolvedValue({
      messages: [
        { bodyText: "Requested older message", id: "older", threadId: "right" },
        { bodyText: "Newer message", id: "newer", threadId: "right" },
      ],
      threadId: "right",
    });
    const app = await mount(
      "/?mailboxId=shared-a&threadId=right&messageId=older"
    );
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.container.textContent).toContain("Requested older");
    });
    await app.navigate({ messageId: "absent", threadId: "right" });
    expect(app.read().selectedMessage).toBeNull();
  });

  test("finishes a complete thread without waiting for folder pages", async () => {
    const folder =
      Promise.withResolvers<Awaited<ReturnType<typeof rpc.mail.listThreads>>>();
    server.listThreads.mockReturnValue(folder.promise);
    server.getThread.mockResolvedValue({
      messages: [{ bodyText: "Ready thread", id: "real", threadId: "thread" }],
      threadId: "thread",
    });
    const app = await mount("/?mailboxId=shared-a&threadId=thread");
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.read().selectedMessage?.id).toBe("real");
    });
    expect(app.read().messagesPending).toBeFalsy();
    folder.resolve({ messages: [] });
  });

  test("keeps the committed thread when a superseded request finishes under another observer", async () => {
    const older = Promise.withResolvers<ThreadMessagesResult>();
    const newer = Promise.withResolvers<ThreadMessagesResult>();
    server.getThread.mockImplementation(async ({ threadId }) =>
      threadId === "first" ? await older.promise : await newer.promise
    );
    const app = await mount("/?mailboxId=shared-a&threadId=first");
    const observer = new QueryObserver(
      app.queryClient,
      getThreadWithDetailsOptions("shared-a", "first")
    );
    const unsubscribe = observer.subscribe(() => {});
    fixtures.push({ dispose: unsubscribe });
    await app.navigate({ threadId: "second" });
    expect(app.read().selectedMessage).toBeNull();
    await act(async () => {
      newer.resolve({
        messages: [
          { bodyText: "Second body", id: "second-real", threadId: "second" },
        ],
        threadId: "second",
      });
      await setTimeout(0);
    });
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.container.textContent).toContain("Second body");
    });
    await act(async () => {
      older.resolve({
        messages: [{ bodyText: "Old body", id: "old-real", threadId: "first" }],
        threadId: "first",
      });
      await setTimeout(0);
    });
    expect(app.read().selectedMessage?.threadId).toBe("second");
    expect(app.container.textContent).not.toContain("Old body");
  });

  test("isolates identical thread IDs across mailboxes and clears the previous retained row", async () => {
    server.listThreads.mockResolvedValue({
      messages: [
        { bodyText: "Original body", id: "original", threadId: "thread" },
      ],
    });
    server.getThread.mockImplementation(async ({ mailboxId, threadId }) => {
      await setTimeout(0);
      return {
        messages: [
          { bodyText: `Body of ${mailboxId}`, id: "shared-id", threadId },
        ],
        threadId,
      };
    });
    const app = await mount(
      "/?mailboxId=shared-a&threadId=thread&messageId=original"
    );
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.read().selectedMessage?.id).toBe("original");
    });
    act(() => {
      app.read().activateListMessage("original");
    });
    await app.navigate({ messageId: null, threadId: "thread" });
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.container.textContent).toContain("Body of shared-a");
    });
    await app.navigate({ mailboxId: "shared-b" });
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.container.textContent).toContain("Body of shared-b");
    });
    expect(app.read().retainedMessageId).toBeNull();
  });

  test("leaves the current selection intact when normal router blocking rejects a destination", async () => {
    server.getThread.mockImplementation(async ({ threadId }) => {
      await setTimeout(0);
      return {
        messages: [
          { bodyText: `Body of ${threadId}`, id: `${threadId}-real`, threadId },
        ],
        threadId,
      };
    });
    const app = await mount("/?mailboxId=shared-a&threadId=first");
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.container.textContent).toContain("Body of first");
    });
    app.control.blocked = true;
    await app.navigate({
      mailboxId: "shared-b",
      messageId: null,
      threadId: "second",
    });
    expect(app.router.state.location.search).toMatchObject({
      mailboxId: "shared-a",
      threadId: "first",
    });
    expect(app.read().selectedMessage?.threadId).toBe("first");
    expect(
      server.getThread.mock.calls.some(([input]) => input.threadId === "second")
    ).toBeFalsy();
    app.control.blocked = false;
    await app.navigate({
      mailboxId: "shared-b",
      messageId: null,
      threadId: "second",
    });
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.container.textContent).toContain("Body of second");
    });
  });

  test.each(["FORBIDDEN", "NOT_FOUND", "MAILBOX_SCOPE_REPAIR_REQUIRED"])(
    "hides retained same-thread data after a %s refetch failure",
    async (code) => {
      server.getThread.mockResolvedValue({
        messages: [
          { bodyText: "Previously accessible", id: "real", threadId: "thread" },
        ],
        threadId: "thread",
      });
      const app = await mount("/?mailboxId=shared-a&threadId=thread");
      app.queryClient.setQueryData(getMailboxesQueryKey(), {
        groups: [
          { mailboxes: [{ connectionStatus: "connected", id: "shared-a" }] },
        ],
      });
      await vi.waitFor(async () => {
        await app.settle();
        expect(app.read().selectedMessage?.id).toBe("real");
      });
      server.getThread.mockRejectedValue(
        Object.assign(new Error("Unavailable"), {
          code,
          data: { emailAddress: "fixture@example.test", mailboxId: "shared-a" },
        })
      );
      await act(async () => {
        await app.queryClient.refetchQueries({
          queryKey: getThreadQueryKey("shared-a", "thread"),
        });
        await setTimeout(0);
      });
      await vi.waitFor(async () => {
        await app.settle();
        expect(app.read().selectedMessage).toBeNull();
      });
      expect(app.container.textContent).not.toContain("Previously accessible");
      expect(app.read().selectedThreadMessages).toBeUndefined();
      expect(
        app.queryClient.getQueryData(getMailboxesQueryKey())
      ).toMatchObject({
        groups: [
          {
            mailboxes: [
              {
                connectionStatus:
                  code === "MAILBOX_SCOPE_REPAIR_REQUIRED"
                    ? "needs_reconnect"
                    : "connected",
                id: "shared-a",
              },
            ],
          },
        ],
      });
    }
  );

  test("retires the old detail for an empty thread or a mismatched response", async () => {
    server.getThread.mockImplementation(async ({ threadId }) => {
      await setTimeout(0);
      return {
        messages:
          threadId === "empty"
            ? []
            : [{ bodyText: "Current body", id: "real", threadId: "first" }],
        threadId: threadId === "mismatch" ? "first" : threadId,
      };
    });
    const app = await mount("/?mailboxId=shared-a&threadId=first");
    await vi.waitFor(async () => {
      await app.settle();
      expect(app.container.textContent).toContain("Current body");
    });
    for (const threadId of ["empty", "mismatch"]) {
      await app.navigate({ threadId });
      await vi.waitFor(async () => {
        await app.settle();
        expect(app.read().messagesPending).toBeFalsy();
      });
      expect(app.read().selectedMessage).toBeNull();
      expect(app.container.textContent).not.toContain("Current body");
    }
  });
});
