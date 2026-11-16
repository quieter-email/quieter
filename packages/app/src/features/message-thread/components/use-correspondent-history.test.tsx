import type { AssistantSidebarContext } from "@quieter/app/features/chat/components/assistant-sidebar-context";
import { toastError } from "@quieter/app/lib/error-toast";
// @vitest-environment jsdom
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query-keys";
import { rpc } from "@quieter/app/lib/orpc";
import { setQueryPersistenceUser } from "@quieter/app/lib/query-persister";
import type { RouterOutputs } from "@quieter/orpc";
import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, StrictMode, useLayoutEffect } from "react";
import type { ContextType } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  createCorrespondentHistory,
  useCorrespondentHistory,
} from "./use-correspondent-history";
import type {
  HistoryMemory,
  HistoryPage,
  MailSource,
} from "./use-correspondent-history";

vi.mock(
  import("@quieter/app/features/chat/components/assistant-sidebar-context"),
  async () => {
    const { createContext } = await import("react");
    return {
      AssistantSidebarContext:
        createContext<ContextType<typeof AssistantSidebarContext>>(null),
    };
  }
);
vi.mock(import("@quieter/app/lib/error-toast"), () => ({
  toastError: vi.fn<(error: unknown) => void>(),
}));
vi.mock(import("@quieter/app/lib/orpc"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      correspondentHistory: {
        list: vi.fn<typeof actual.rpc.correspondentHistory.list>(),
        openSource: vi.fn<typeof actual.rpc.correspondentHistory.openSource>(),
      },
    },
  };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const correspondentEmails = ["person@example.com"];
const HistoryProbe = ({
  expose,
  navigate,
}: {
  expose: (history: ReturnType<typeof useCorrespondentHistory>) => void;
  navigate: Parameters<typeof useCorrespondentHistory>[0]["onOpenConversation"];
}) => {
  const history = useCorrespondentHistory({
    actorId: "actor",
    correspondentEmails,
    mailboxId: "mailbox",
    onOpenConversation: navigate,
    sessionId: "session",
    threadId: "origin-thread",
  });
  useLayoutEffect(() => {
    expose(history);
  }, [expose, history]);
  return <span>{history.view.kind}</span>;
};

const memory: HistoryMemory = {
  category: "preferences",
  content: "Prefers a written agenda before a meeting.",
  correspondents: ["person@example.com"],
  id: "personal-memory",
  kind: "learned",
  provenance: {
    confidence: 0.8,
    createdAt: "2026-11-01T10:00:00.000Z",
    expiresAt: null,
    lastConfirmedAt: "2026-11-01T10:00:00.000Z",
    reinforcementCount: 1,
    source: "explicit",
  },
  source: "explicit",
  summary: "Meeting agenda preference",
  updatedAt: "2026-11-01T10:00:00.000Z",
  version: 2,
};
const mailPage: HistoryPage = {
  correspondentEmail: "person@example.com",
  items: [],
  mailboxId: "mailbox",
  nextCursor: null,
  section: "mail",
};
const memoryPage: HistoryPage = {
  ...mailPage,
  items: [memory],
  section: "memory",
};
const source: MailSource = {
  kind: "mail",
  messageId: "source-message",
  revision: "verified-revision",
  threadId: "source-thread",
};
const opened: RouterOutputs["correspondentHistory"]["openSource"] = {
  messageId: source.messageId,
  thread: {
    messages: [
      {
        bodyHtml: "<p>A complete verified message.</p>",
        from: "Person <person@example.com>",
        id: source.messageId,
        senderAvatarUrls: { dark: "/dark.png", light: "/light.png" },
        sourceRevision: source.revision,
        threadId: source.threadId,
        threadMessageCount: 1,
      },
    ],
    threadId: source.threadId,
  },
};

const cleanups: (() => void)[] = [];
const setup = () => {
  const client = new QueryClient();
  const api = {
    list: vi.fn<typeof rpc.correspondentHistory.list>(),
    openSource: vi.fn<typeof rpc.correspondentHistory.openSource>(),
  };
  const navigate = vi
    .fn<
      (target: {
        mailboxId: string;
        messageId: string;
        threadId: string;
      }) => Promise<void>
    >()
    .mockResolvedValue();
  const reportError = vi.fn<(error: unknown) => void>();
  const history = createCorrespondentHistory({
    actorId: "actor",
    api,
    correspondentEmails: ["person@example.com", "other@example.com"],
    mailboxId: "mailbox",
    onOpenConversation: navigate,
    queryClient: client,
    reportError,
    sessionId: "session",
    threadId: "origin-thread",
  });
  cleanups.push(() => {
    history.endSession();
    client.clear();
  });
  history.open();
  history.selectCorrespondent("person@example.com");
  const { view } = history.state.get();
  if (view.kind !== "selected") {
    throw new Error("A selected correspondent is required for this case.");
  }
  return { api, client, history, navigate, reportError, scope: view.scope };
};

describe("correspondent history", () => {
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).toReversed()) {
      cleanup();
    }
    vi.restoreAllMocks();
  });

  test("can open after React StrictMode reattaches its effects", () => {
    const client = new QueryClient();
    const container = document.createElement("div");
    const root = createRoot(container);
    const exposed: ReturnType<typeof useCorrespondentHistory>[] = [];
    const navigate = vi
      .fn<Parameters<typeof useCorrespondentHistory>[0]["onOpenConversation"]>()
      .mockResolvedValue();
    const expose = (history: ReturnType<typeof useCorrespondentHistory>) => {
      exposed.push(history);
    };
    vi.mocked(rpc.correspondentHistory.list).mockResolvedValue(mailPage);
    try {
      act(() => {
        root.render(
          <StrictMode>
            <QueryClientProvider client={client}>
              <HistoryProbe expose={expose} navigate={navigate} />
            </QueryClientProvider>
          </StrictMode>
        );
      });
      const history = exposed.at(-1);
      if (!history) {
        throw new Error("The history hook did not mount.");
      }
      act(() => {
        history.open();
        history.selectCorrespondent("person@example.com");
      });
      expect(container.textContent).toBe("selected");
      expect(exposed.at(-1)?.sessionEnded).toBeFalsy();
    } finally {
      act(() => {
        root.unmount();
      });
      client.clear();
      container.remove();
    }
  });

  test("fences delayed list and source completions after a real React unmount", async () => {
    const client = new QueryClient();
    const container = document.createElement("div");
    const root = createRoot(container);
    const exposed: ReturnType<typeof useCorrespondentHistory>[] = [];
    const navigate = vi
      .fn<Parameters<typeof useCorrespondentHistory>[0]["onOpenConversation"]>()
      .mockResolvedValue();
    const expose = (history: ReturnType<typeof useCorrespondentHistory>) => {
      exposed.push(history);
    };
    const list = Promise.withResolvers<HistoryPage>();
    const sourceResponse = Promise.withResolvers<typeof opened>();
    vi.mocked(rpc.correspondentHistory.list)
      .mockReset()
      .mockReturnValueOnce(list.promise);
    vi.mocked(rpc.correspondentHistory.openSource)
      .mockReset()
      .mockReturnValueOnce(sourceResponse.promise);
    vi.mocked(toastError).mockClear();
    try {
      act(() => {
        root.render(
          <StrictMode>
            <QueryClientProvider client={client}>
              <HistoryProbe expose={expose} navigate={navigate} />
            </QueryClientProvider>
          </StrictMode>
        );
      });
      const mounted = exposed.at(-1);
      if (!mounted) {
        throw new Error("The history hook did not mount.");
      }
      act(() => {
        mounted.open();
        mounted.selectCorrespondent("person@example.com");
      });
      const selected = exposed.at(-1);
      if (!selected || selected.view.kind !== "selected") {
        throw new Error("The history selection did not open.");
      }
      const { queryKey } = selected.queryOptions("mail", selected.view.scope);
      let operation: Promise<void> | undefined;
      act(() => {
        operation = selected.openSource(source, "mail");
      });
      act(() => {
        root.unmount();
      });
      await act(async () => {
        list.resolve(mailPage);
        sourceResponse.resolve(opened);
        await operation;
      });
      expect(client.getQueryData(queryKey)).toBeUndefined();
      expect(
        client.getQueryData(getThreadQueryKey("mailbox", source.threadId))
      ).toBeUndefined();
      expect(navigate).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      client.clear();
      container.remove();
    }
  });

  test("keeps explicit session invalidation terminal after effect reattachment", () => {
    const client = new QueryClient();
    const nextClient = new QueryClient();
    const container = document.createElement("div");
    const root = createRoot(container);
    const exposed: ReturnType<typeof useCorrespondentHistory>[] = [];
    const navigate = vi
      .fn<Parameters<typeof useCorrespondentHistory>[0]["onOpenConversation"]>()
      .mockResolvedValue();
    const expose = (history: ReturnType<typeof useCorrespondentHistory>) => {
      exposed.push(history);
    };
    setQueryPersistenceUser("actor", client, "session");
    try {
      act(() => {
        root.render(
          <StrictMode>
            <QueryClientProvider client={client}>
              <HistoryProbe expose={expose} navigate={navigate} />
            </QueryClientProvider>
          </StrictMode>
        );
      });
      const mounted = exposed.at(-1);
      if (!mounted) {
        throw new Error("The history hook did not mount.");
      }
      act(() => {
        setQueryPersistenceUser("actor", nextClient, "next-session");
        const detach = mounted.attach();
        mounted.open();
        mounted.selectCorrespondent("person@example.com");
        detach();
      });
      expect(container.textContent).toBe("closed");
      expect(exposed.at(-1)?.sessionEnded).toBeTruthy();
    } finally {
      act(() => {
        root.unmount();
      });
      client.clear();
      nextClient.clear();
      container.remove();
    }
  });

  describe("correspondent history private lifetime", () => {
    test.each([
      "close",
      "correspondent",
      "session",
      "mailbox",
      "origin thread",
      "choices",
    ])("discards a delayed page after %s retirement", async (boundary) => {
      const { api, client, history, navigate, reportError, scope } = setup();
      const response = Promise.withResolvers<HistoryPage>();
      api.list.mockReturnValueOnce(response.promise);
      const options = history.queryOptions("mail", scope);
      const fetch = Promise.allSettled([client.infiniteQuery(options)]);
      switch (boundary) {
        case "close": {
          history.close();
          break;
        }
        case "correspondent": {
          history.selectCorrespondent("other@example.com");
          break;
        }
        case "session": {
          history.endSession();
          break;
        }
        case "mailbox": {
          history.loseAccess({ mailboxId: "mailbox" });
          break;
        }
        case "origin thread": {
          history.loseAccess({
            mailboxId: "mailbox",
            threadId: "origin-thread",
          });
          break;
        }
        case "choices": {
          history.updateInputs({ emails: ["other@example.com"], navigate });
          break;
        }
        default: {
          throw new Error("Unexpected retirement boundary.");
        }
      }
      expect(history.isCurrent(scope)).toBeFalsy();
      response.resolve(mailPage);
      await fetch;
      expect(client.getQueryData(options.queryKey)).toBeUndefined();
      expect(reportError).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    test("keeps an unrelated selection intact when an obsolete source fails", async () => {
      const { api, client, history, navigate, reportError } = setup();
      const response = Promise.withResolvers<typeof opened>();
      api.openSource.mockReturnValueOnce(response.promise);
      const operation = history.openSource(source, "mail");
      history.selectCorrespondent("other@example.com");
      response.reject(
        Object.assign(new Error("Old request denied"), { status: 403 })
      );
      await operation;
      expect(history.state.get().view).toMatchObject({
        kind: "selected",
        scope: { correspondentEmail: "other@example.com" },
      });
      expect(
        client.getQueryData(getThreadQueryKey("mailbox", source.threadId))
      ).toBeUndefined();
      expect(navigate).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    });

    test("opens only the latest freshly verified source and preserves the complete thread", async () => {
      const { api, client, history, navigate, reportError } = setup();
      const first = Promise.withResolvers<typeof opened>();
      const second = Promise.withResolvers<typeof opened>();
      api.openSource
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const firstOpen = history.openSource(source, "mail");
      const secondOpen = history.openSource(source, "mail");
      first.resolve(opened);
      await firstOpen;
      expect(navigate).not.toHaveBeenCalled();
      expect(
        client.getQueryData(getThreadQueryKey("mailbox", source.threadId))
      ).toBeUndefined();
      second.resolve(opened);
      await secondOpen;
      expect(
        client.getQueryData(getThreadQueryKey("mailbox", source.threadId))
      ).toBe(opened.thread);
      expect(navigate).toHaveBeenCalledExactlyOnceWith({
        mailboxId: "mailbox",
        messageId: source.messageId,
        threadId: source.threadId,
      });
      expect(history.state.get().view.kind).toBe("closed");
      expect(history.consumeFocusHandoff()).toBeTruthy();
      expect(reportError).not.toHaveBeenCalled();
    });

    test("does not seed or navigate when retired during canonical query cancellation", async () => {
      const { api, client, history, navigate, reportError } = setup();
      const cancellation = Promise.withResolvers<null>();
      const waiting = Promise.withResolvers<null>();
      api.openSource.mockResolvedValueOnce(opened);
      vi.spyOn(client, "cancelQueries").mockImplementationOnce(async () => {
        waiting.resolve(null);
        await cancellation.promise;
      });
      const operation = history.openSource(source, "mail");
      await waiting.promise;
      history.close();
      cancellation.resolve(null);
      await operation;
      expect(
        client.getQueryData(getThreadQueryKey("mailbox", source.threadId))
      ).toBeUndefined();
      expect(navigate).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    });

    test("prevents an older canonical fetch from overwriting the verified source", async () => {
      const { api, client, history, navigate } = setup();
      const previous = Promise.withResolvers<typeof opened.thread>();
      const queryKey = getThreadQueryKey("mailbox", source.threadId);
      const oldFetch = Promise.allSettled([
        client.query({
          queryFn: async ({ signal }) => {
            signal.throwIfAborted();
            return await previous.promise;
          },
          queryKey,
        }),
      ]);
      api.openSource.mockResolvedValueOnce(opened);
      await history.openSource(source, "mail");
      previous.resolve({ messages: [], threadId: source.threadId });
      await oldFetch;
      expect(client.getQueryData(queryKey)).toBe(opened.thread);
      expect(navigate).toHaveBeenCalledOnce();
    });

    test.each(["tab", "source access"])(
      "aborts navigation on %s change",
      async (boundary) => {
        const { api, client, history, navigate, reportError } = setup();
        const response = Promise.withResolvers<typeof opened>();
        api.openSource.mockReturnValueOnce(response.promise);
        const operation = history.openSource(source, "mail");
        if (boundary === "tab") {
          history.selectSection("memory");
        } else {
          history.loseAccess({
            mailboxId: "mailbox",
            threadId: source.threadId,
          });
        }
        response.resolve(opened);
        await operation;
        expect(history.state.get().view.kind).toBe("selected");
        expect(
          client.getQueryData(getThreadQueryKey("mailbox", source.threadId))
        ).toBeUndefined();
        expect(navigate).not.toHaveBeenCalled();
        expect(reportError).not.toHaveBeenCalled();
      }
    );

    test.each([
      { status: 401 },
      { status: 403 },
      { data: { resource: "mailbox" }, status: 404 },
    ])(
      "clears retained pages and the editor on a current denial %j",
      async (details) => {
        const { api, client, history, reportError, scope } = setup();
        api.list
          .mockResolvedValueOnce(mailPage)
          .mockResolvedValueOnce(memoryPage);
        const mailOptions = history.queryOptions("mail", scope);
        const memoryOptions = history.queryOptions("memory", scope);
        await client.infiniteQuery(mailOptions);
        await client.infiniteQuery(memoryOptions);
        history.editMemory(memory);
        const error = Object.assign(new Error("Access was removed"), details);
        api.openSource.mockRejectedValueOnce(error);
        await history.openSource(source, "mail");
        expect(history.state.get().view.kind).toBe("closed");
        expect(client.getQueryData(mailOptions.queryKey)).toBeUndefined();
        expect(client.getQueryData(memoryOptions.queryKey)).toBeUndefined();
        expect(reportError).toHaveBeenCalledExactlyOnceWith(error);
      }
    );

    test("does not revoke unrelated mailboxes or threads", () => {
      const { history, scope } = setup();
      history.loseAccess({ mailboxId: "other-mailbox" });
      history.loseAccess({ mailboxId: "mailbox", threadId: "other-thread" });
      expect(history.isCurrent(scope)).toBeTruthy();
      history.endSession();
      history.open();
      history.selectCorrespondent("person@example.com");
      expect(history.state.get().view.kind).toBe("closed");
    });

    test("clears retained pages immediately when a list continuation denies access", async () => {
      const { api, client, history, reportError, scope } = setup();
      const denial = Object.assign(new Error("Access was removed"), {
        status: 403,
      });
      api.list
        .mockResolvedValueOnce(mailPage)
        .mockResolvedValueOnce({ ...memoryPage, nextCursor: "memory-next" })
        .mockRejectedValueOnce(denial);
      const mailOptions = history.queryOptions("mail", scope);
      await client.infiniteQuery(mailOptions);
      history.selectSection("memory");
      const memoryOptions = history.queryOptions("memory", scope);
      const observer = new InfiniteQueryObserver(client, memoryOptions);
      cleanups.push(observer.subscribe(() => {}));
      await observer.refetch();
      history.editMemory(memory);
      await observer.fetchNextPage();
      expect(history.state.get().view.kind).toBe("closed");
      expect(client.getQueryData(mailOptions.queryKey)).toBeUndefined();
      expect(client.getQueryData(memoryOptions.queryKey)).toBeUndefined();
      expect(reportError).toHaveBeenCalledExactlyOnceWith(denial);
    });

    test.each([
      { kind: "unavailable", status: 404 },
      { kind: "stale", status: 409 },
    ])(
      "retains the selection after a source-only $status response",
      async ({ kind, status }) => {
        const { api, client, history, reportError, scope } = setup();
        api.list.mockResolvedValueOnce(mailPage);
        const options = history.queryOptions("mail", scope);
        const data = await client.infiniteQuery(options);
        const failure = Object.assign(new Error("The source changed"), {
          status,
        });
        api.openSource.mockRejectedValueOnce(failure);
        await history.openSource(source, "mail");
        expect(history.state.get().view).toMatchObject({
          kind: "selected",
          source: { kind },
        });
        expect(client.getQueryData(options.queryKey)).toBe(data);
        expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
        history.refreshSection("mail");
        expect(client.getQueryData(options.queryKey)).toBeUndefined();
      }
    );

    test("rejects pages that cross a selection boundary", async () => {
      const { api, client, history, reportError, scope } = setup();
      api.list.mockResolvedValueOnce({
        ...mailPage,
        correspondentEmail: "other@example.com",
      });
      const options = history.queryOptions("mail", scope);
      await expect(client.infiniteQuery(options)).rejects.toThrow(/selection/u);
      expect(client.getQueryData(options.queryKey)).toBeUndefined();
      expect(reportError).toHaveBeenCalledOnce();
    });
  });

  describe("correspondent history independent pages and correction", () => {
    test("continues through sparse pages and retains them after a continuation failure", async () => {
      const { api, client, history, reportError, scope } = setup();
      history.selectSection("commitments");
      const sparsePage: HistoryPage = {
        ...mailPage,
        items: [],
        nextCursor: "opaque-next-position",
        section: "commitments",
      };
      const failure = Object.assign(new Error("Temporary failure"), {
        status: 503,
      });
      api.list
        .mockResolvedValueOnce(sparsePage)
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({
          ...sparsePage,
          nextCursor: null,
        });
      const observer = new InfiniteQueryObserver(
        client,
        history.queryOptions("commitments", scope)
      );
      const unsubscribe = observer.subscribe(() => {});
      cleanups.push(unsubscribe);
      await observer.refetch();
      expect(observer.getCurrentResult().hasNextPage).toBeTruthy();
      await observer.fetchNextPage();
      expect(observer.getCurrentResult().data?.pages).toHaveLength(1);
      expect(observer.getCurrentResult().isFetchNextPageError).toBeTruthy();
      expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
      await observer.fetchNextPage();
      expect(api.list.mock.lastCall?.[0]).toMatchObject({
        cursor: "opaque-next-position",
        section: "commitments",
      });
      expect(observer.getCurrentResult().data?.pages).toHaveLength(2);
      expect(observer.getCurrentResult().hasNextPage).toBeFalsy();
    });

    test("resets only current memory pages and ignores callbacks from an older editor", async () => {
      const { api, client, history, navigate, scope } = setup();
      api.list
        .mockResolvedValueOnce(mailPage)
        .mockResolvedValueOnce(memoryPage);
      const mailOptions = history.queryOptions("mail", scope);
      const memoryOptions = history.queryOptions("memory", scope);
      const mailData = await client.infiniteQuery(mailOptions);
      await client.infiniteQuery(memoryOptions);
      history.editMemory(memory);
      history.memorySaved(scope, memory.id);
      expect(client.getQueryData(mailOptions.queryKey)).toBe(mailData);
      expect(client.getQueryData(memoryOptions.queryKey)).toBeUndefined();
      history.selectCorrespondent("other@example.com");
      const next = history.state.get().view;
      expect(next.kind).toBe("selected");
      history.editMemory({ ...memory, id: "next-memory" });
      history.closeEditor(scope, memory.id);
      history.memorySaved(scope, memory.id);
      history.updateInputs({
        emails: ["person@example.com", "other@example.com"],
        navigate,
      });
      expect(history.state.get().view).toMatchObject({
        editingMemory: { id: "next-memory" },
        kind: "selected",
        scope: { correspondentEmail: "other@example.com" },
      });
    });

    test("hands off fresh reminder detail while retaining focus intent through close", async () => {
      const { history, reportError } = setup();
      const response = Promise.withResolvers<undefined>();
      const openReminders = vi
        .fn<Parameters<typeof history.openReminder>[2]>()
        .mockReturnValueOnce(response.promise);
      const operation = history.openReminder(
        "reminder",
        undefined,
        openReminders
      );
      expect(history.state.get().view.kind).toBe("closed");
      expect(history.consumeFocusHandoff()).toBeTruthy();
      expect(openReminders).toHaveBeenCalledExactlyOnceWith(
        undefined,
        "mailbox",
        {
          kind: "detail",
          reminderId: "reminder",
        }
      );
      history.endSession();
      response.reject(new Error("Old sidebar failure"));
      await operation;
      expect(reportError).not.toHaveBeenCalled();
    });

    test("reports reminder failure only for the attachment that started its handoff", async () => {
      const { history, reportError } = setup();
      const detach = history.attach();
      const oldResponse = Promise.withResolvers<undefined>();
      const openReminders = vi
        .fn<Parameters<typeof history.openReminder>[2]>()
        .mockReturnValueOnce(oldResponse.promise);
      const oldHandoff = history.openReminder(
        "old-reminder",
        undefined,
        openReminders
      );
      detach();
      const detachNext = history.attach();
      history.open();
      history.selectCorrespondent("person@example.com");
      oldResponse.reject(new Error("An older sidebar failed"));
      await oldHandoff;
      expect(reportError).not.toHaveBeenCalled();
      const currentFailure = new Error("The current sidebar failed");
      openReminders.mockRejectedValueOnce(currentFailure);
      await history.openReminder("current-reminder", undefined, openReminders);
      expect(reportError).toHaveBeenCalledExactlyOnceWith(currentFailure);
      detachNext();
    });
  });
});
