import { AssistantSidebarContext } from "@quieter/app/features/chat/components/assistant-sidebar-context";
import { toastError } from "@quieter/app/lib/error-toast";
import { subscribeMailboxAccessLoss } from "@quieter/app/lib/mail-cache-lifecycle";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query-keys";
import { rpc } from "@quieter/app/lib/orpc";
import { subscribeQuerySessionInvalidation } from "@quieter/app/lib/query-persister";
import type { RouterInputs, RouterOutputs } from "@quieter/orpc";
import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  InfiniteData,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { createStore, useSelector } from "@tanstack/react-store";
import { use, useLayoutEffect, useState } from "react";
import type { ContextType } from "react";

type HistoryInput = RouterInputs["correspondentHistory"]["list"];
export type HistoryPage = RouterOutputs["correspondentHistory"]["list"];
export type HistorySection = HistoryInput["section"];
export type HistoryMemory = Extract<
  HistoryPage,
  { section: "memory" }
>["items"][number];
export type MailSource =
  RouterInputs["correspondentHistory"]["openSource"]["source"];
type ConversationTarget = {
  mailboxId: HistoryInput["mailboxId"];
  threadId: MailSource["threadId"];
  messageId: MailSource["messageId"];
};
type HistoryOwner = Readonly<{
  actorId: string;
  sessionId: string;
  mailboxId: string;
  threadId: string;
  queryClient: QueryClient;
  controller: AbortController;
}>;
export type HistoryScope = Readonly<{
  owner: HistoryOwner;
  instanceId: string;
  correspondentEmail: string;
  controller: AbortController;
}>;
type HistorySourceState =
  | { kind: "idle" }
  | {
      kind: "opening";
      source: MailSource;
      section: HistorySection;
      controller: AbortController;
      ticket: string;
    }
  | {
      kind: "unavailable" | "stale" | "failed";
      source: MailSource;
      section: HistorySection;
    };
type HistoryView =
  | { kind: "closed" }
  | { kind: "choosing" }
  | {
      kind: "selected";
      scope: HistoryScope;
      section: HistorySection;
      source: HistorySourceState;
      editingMemory: HistoryMemory | null;
    };
type HistoryOptions = {
  actorId: string;
  sessionId: string;
  mailboxId: string;
  threadId: string;
  correspondentEmails: readonly string[];
  onOpenConversation: (target: ConversationTarget) => Promise<void>;
};

const privateHistoryKey = (scope: HistoryScope) =>
  [
    "correspondent-history",
    scope.owner.actorId,
    scope.owner.sessionId,
    scope.owner.mailboxId,
    scope.owner.threadId,
    scope.correspondentEmail,
    scope.instanceId,
  ] as const;

const classifyFailure = (error: unknown) => {
  let current = error;
  const visited = new Set<unknown>();
  while (
    typeof current === "object" &&
    current !== null &&
    !visited.has(current)
  ) {
    visited.add(current);
    const status = "status" in current ? current.status : undefined;
    const code = "code" in current ? current.code : undefined;
    const data = "data" in current ? current.data : undefined;
    if (
      status === 401 ||
      status === 403 ||
      code === "UNAUTHORIZED" ||
      code === "FORBIDDEN" ||
      (typeof data === "object" &&
        data !== null &&
        "resource" in data &&
        data.resource === "mailbox")
    ) {
      return "denied";
    }
    if (status === 404 || code === "NOT_FOUND") {
      return "unavailable";
    }
    if (status === 409 || code === "CONFLICT") {
      return "stale";
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return "failed";
};

export const createCorrespondentHistory = ({
  queryClient,
  api,
  reportError,
  ...options
}: HistoryOptions & {
  queryClient: QueryClient;
  api: Pick<typeof rpc.correspondentHistory, "list" | "openSource">;
  reportError: (error: unknown) => void;
}) => {
  let owner: HistoryOwner = {
    actorId: options.actorId,
    controller: new AbortController(),
    mailboxId: options.mailboxId,
    queryClient,
    sessionId: options.sessionId,
    threadId: options.threadId,
  };
  let { correspondentEmails, onOpenConversation } = options;
  const focusHandoff = { current: false };
  const state = createStore<{ view: HistoryView; sessionEnded: boolean }>({
    sessionEnded: false,
    view: { kind: "closed" },
  });
  const isCurrent = (scope: HistoryScope) => {
    const { view } = state.get();
    return (
      !owner.controller.signal.aborted &&
      scope.owner === owner &&
      !scope.controller.signal.aborted &&
      view.kind === "selected" &&
      view.scope === scope
    );
  };
  const retire = (nextView: { kind: "closed" | "choosing" }) => {
    const { view } = state.get();
    if (view.kind === "selected") {
      view.scope.controller.abort();
      if (view.source.kind === "opening") {
        view.source.controller.abort();
      }
    }
    state.setState((current) => ({ ...current, view: nextView }));
    if (view.kind === "selected") {
      const queryKey = privateHistoryKey(view.scope);
      void queryClient.cancelQueries({ queryKey });
      queryClient.removeQueries({ queryKey });
    }
  };
  const stopSource = () => {
    const { view } = state.get();
    if (view.kind === "selected" && view.source.kind === "opening") {
      view.source.controller.abort();
    }
  };
  const refreshSection = (section: HistorySection) => {
    const { view } = state.get();
    if (view.kind !== "selected" || !isCurrent(view.scope)) {
      return;
    }
    if (view.source.kind !== "idle" && view.source.section === section) {
      stopSource();
      state.setState((current) => ({
        ...current,
        view: { ...view, source: { kind: "idle" } },
      }));
    }
    void queryClient.resetQueries({
      exact: true,
      queryKey: [...privateHistoryKey(view.scope), section],
    });
  };
  return {
    attach() {
      if (owner.controller.signal.aborted && !state.get().sessionEnded) {
        owner = { ...owner, controller: new AbortController() };
      }
      const attachedOwner = owner;
      return () => {
        attachedOwner.controller.abort();
        if (owner === attachedOwner) {
          retire({ kind: "closed" });
        }
      };
    },
    close() {
      retire({ kind: "closed" });
    },
    closeEditor(scope: HistoryScope, memoryId: string) {
      const { view } = state.get();
      if (
        view.kind === "selected" &&
        isCurrent(scope) &&
        view.editingMemory?.id === memoryId
      ) {
        state.setState((current) => ({
          ...current,
          view: { ...view, editingMemory: null },
        }));
      }
    },
    consumeFocusHandoff() {
      const handoff = focusHandoff.current;
      focusHandoff.current = false;
      return handoff;
    },
    editMemory(memory: HistoryMemory) {
      const { view } = state.get();
      if (view.kind === "selected" && isCurrent(view.scope)) {
        state.setState((current) => ({
          ...current,
          view: { ...view, editingMemory: memory },
        }));
      }
    },
    endSession: () => {
      owner.controller.abort();
      retire({ kind: "closed" });
      state.setState((current) => ({ ...current, sessionEnded: true }));
    },
    isCurrent,
    loseAccess: (loss: { mailboxId: string; threadId?: string }) => {
      if (loss.mailboxId !== owner.mailboxId) {
        return;
      }
      if (loss.threadId === undefined || loss.threadId === owner.threadId) {
        retire({ kind: "closed" });
        return;
      }
      const { view } = state.get();
      if (
        view.kind === "selected" &&
        view.source.kind !== "idle" &&
        view.source.source.threadId === loss.threadId
      ) {
        const { source, section } = view.source;
        stopSource();
        state.setState((current) => ({
          ...current,
          view: {
            ...view,
            source: {
              kind: "unavailable",
              section,
              source,
            },
          },
        }));
      }
    },
    memorySaved(scope: HistoryScope, memoryId: string) {
      const { view } = state.get();
      if (
        view.kind !== "selected" ||
        !isCurrent(scope) ||
        view.editingMemory?.id !== memoryId
      ) {
        return;
      }
      state.setState((current) => ({
        ...current,
        view: { ...view, editingMemory: null },
      }));
      refreshSection("memory");
    },
    open() {
      if (
        !owner.controller.signal.aborted &&
        state.get().view.kind === "closed"
      ) {
        focusHandoff.current = false;
        state.setState((current) => ({
          ...current,
          view: { kind: "choosing" },
        }));
      }
    },
    async openReminder(
      reminderId: string,
      trigger: HTMLButtonElement | undefined,
      openReminders: NonNullable<
        ContextType<typeof AssistantSidebarContext>
      >["onOpenReminders"]
    ) {
      const { view } = state.get();
      if (view.kind !== "selected" || !isCurrent(view.scope)) {
        return;
      }
      const requestOwner = owner;
      focusHandoff.current = true;
      retire({ kind: "closed" });
      try {
        await openReminders(trigger, owner.mailboxId, {
          kind: "detail",
          reminderId,
        });
      } catch (error) {
        if (owner === requestOwner && !requestOwner.controller.signal.aborted) {
          reportError(error);
        }
      }
    },
    async openSource(source: MailSource, section: HistorySection) {
      const { view } = state.get();
      if (
        view.kind !== "selected" ||
        view.section !== section ||
        !isCurrent(view.scope)
      ) {
        return;
      }
      stopSource();
      const { scope } = view;
      const request = {
        controller: new AbortController(),
        kind: "opening",
        section,
        source,
        ticket: crypto.randomUUID(),
      } satisfies HistorySourceState;
      state.setState((current) => ({
        ...current,
        view: { ...view, source: request },
      }));
      const isCurrentRequest = () => {
        const current = state.get().view;
        return (
          isCurrent(scope) &&
          !request.controller.signal.aborted &&
          current.kind === "selected" &&
          current.source.kind === "opening" &&
          current.source.ticket === request.ticket
        );
      };
      try {
        const opened = await api.openSource(
          {
            correspondentEmail: scope.correspondentEmail,
            mailboxId: owner.mailboxId,
            source,
          },
          {
            signal: AbortSignal.any([
              scope.controller.signal,
              request.controller.signal,
            ]),
          }
        );
        if (!isCurrentRequest()) {
          return;
        }
        if (
          opened.messageId !== source.messageId ||
          opened.thread.threadId !== source.threadId ||
          !opened.thread.messages.some(
            (message) => message.id === opened.messageId
          )
        ) {
          throw new Error("The source response did not match its selection.");
        }
        const queryKey = getThreadQueryKey(
          owner.mailboxId,
          opened.thread.threadId
        );
        await queryClient.cancelQueries({ exact: true, queryKey });
        if (!isCurrentRequest()) {
          return;
        }
        queryClient.setQueryData(queryKey, opened.thread);
        focusHandoff.current = true;
        const navigation = onOpenConversation({
          mailboxId: owner.mailboxId,
          messageId: opened.messageId,
          threadId: opened.thread.threadId,
        });
        await navigation;
        if (isCurrentRequest()) {
          retire({ kind: "closed" });
        }
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        const failure = classifyFailure(error);
        if (failure === "denied") {
          retire({ kind: "closed" });
        } else {
          state.setState((current) =>
            current.view.kind === "selected"
              ? {
                  ...current,
                  view: {
                    ...current.view,
                    source: { kind: failure, section, source },
                  },
                }
              : current
          );
        }
        reportError(error);
      }
    },
    get owner() {
      return owner;
    },
    queryOptions(section: HistorySection, scope: HistoryScope | null) {
      const { view } = state.get();
      return infiniteQueryOptions<
        HistoryPage,
        Error,
        InfiniteData<HistoryPage>,
        QueryKey,
        string | undefined
      >({
        enabled:
          scope !== null &&
          isCurrent(scope) &&
          view.kind === "selected" &&
          view.section === section,
        gcTime: 0,
        getNextPageParam: (lastPage: HistoryPage) => lastPage.nextCursor,
        initialPageParam: undefined,
        persister: undefined,
        queryFn: async ({ pageParam, signal }): Promise<HistoryPage> => {
          if (!scope || !isCurrent(scope)) {
            throw new DOMException(
              "The history selection has closed.",
              "AbortError"
            );
          }
          const requestSignal = AbortSignal.any([
            scope.controller.signal,
            signal,
          ]);
          try {
            requestSignal.throwIfAborted();
            const page = await api.list(
              {
                correspondentEmail: scope.correspondentEmail,
                cursor: pageParam,
                mailboxId: owner.mailboxId,
                section,
              },
              { signal: requestSignal }
            );
            requestSignal.throwIfAborted();
            if (!isCurrent(scope)) {
              throw new DOMException(
                "The history selection has closed.",
                "AbortError"
              );
            }
            if (
              page.mailboxId !== owner.mailboxId ||
              page.correspondentEmail !== scope.correspondentEmail ||
              page.section !== section
            ) {
              throw new Error(
                "The history response did not match its selection."
              );
            }
            return page;
          } catch (error) {
            if (!requestSignal.aborted && isCurrent(scope)) {
              if (classifyFailure(error) === "denied") {
                retire({ kind: "closed" });
              }
              reportError(error);
            }
            throw error;
          }
        },
        queryKey: scope
          ? [...privateHistoryKey(scope), section]
          : [
              "correspondent-history-idle",
              owner.actorId,
              owner.sessionId,
              owner.mailboxId,
              owner.threadId,
              section,
            ],
        refetchInterval: false,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
      });
    },
    refreshSection,
    selectCorrespondent(correspondentEmail: string) {
      const { view } = state.get();
      if (
        owner.controller.signal.aborted ||
        view.kind === "closed" ||
        !correspondentEmails.includes(correspondentEmail) ||
        (view.kind === "selected" &&
          view.scope.correspondentEmail === correspondentEmail)
      ) {
        return;
      }
      retire({ kind: "choosing" });
      state.setState((current) => ({
        ...current,
        view: {
          editingMemory: null,
          kind: "selected",
          scope: {
            controller: new AbortController(),
            correspondentEmail,
            instanceId: crypto.randomUUID(),
            owner,
          },
          section: "mail",
          source: { kind: "idle" },
        },
      }));
    },
    selectSection(section: HistorySection) {
      const { view } = state.get();
      if (
        view.kind === "selected" &&
        isCurrent(view.scope) &&
        view.section !== section
      ) {
        stopSource();
        state.setState((current) => ({
          ...current,
          view: { ...view, section, source: { kind: "idle" } },
        }));
      }
    },
    state,
    updateInputs({
      emails,
      navigate,
    }: {
      emails: readonly string[];
      navigate: HistoryOptions["onOpenConversation"];
    }) {
      correspondentEmails = emails;
      onOpenConversation = navigate;
      const { view } = state.get();
      if (
        view.kind === "selected" &&
        !emails.includes(view.scope.correspondentEmail)
      ) {
        retire({ kind: "choosing" });
      }
    },
  };
};

export const useCorrespondentHistory = (options: HistoryOptions) => {
  const queryClient = useQueryClient();
  const sidebar = use(AssistantSidebarContext);
  const { actorId, sessionId, mailboxId, threadId } = options;
  // oxlint-disable-next-line react/hook-use-state -- The caller keys this private owner by actor, session, mailbox, and originating thread.
  const [history] = useState(() =>
    createCorrespondentHistory({
      actorId,
      api: rpc.correspondentHistory,
      correspondentEmails: options.correspondentEmails,
      mailboxId,
      onOpenConversation: options.onOpenConversation,
      queryClient,
      reportError(error) {
        toastError(error, { boundary: "correspondent-history" });
      },
      sessionId,
      threadId,
    })
  );
  const snapshot = useSelector(history.state);
  const ownsCurrentInputs =
    history.owner.actorId === actorId &&
    history.owner.sessionId === sessionId &&
    history.owner.mailboxId === mailboxId &&
    history.owner.threadId === threadId &&
    history.owner.queryClient === queryClient;
  const view: HistoryView = ownsCurrentInputs
    ? snapshot.view
    : { kind: "closed" };
  useLayoutEffect(() => {
    const detach = history.attach();
    const unsubscribeSession = subscribeQuerySessionInvalidation(
      queryClient,
      history.endSession
    );
    const unsubscribeAccess = subscribeMailboxAccessLoss(
      queryClient,
      history.loseAccess
    );
    return () => {
      detach();
      unsubscribeSession();
      unsubscribeAccess();
    };
  }, [history, queryClient]);
  useLayoutEffect(() => {
    if (!ownsCurrentInputs) {
      history.endSession();
    }
    history.updateInputs({
      emails: options.correspondentEmails,
      navigate: options.onOpenConversation,
    });
  }, [
    history,
    options.correspondentEmails,
    options.onOpenConversation,
    ownsCurrentInputs,
  ]);
  const scope = view.kind === "selected" ? view.scope : null;
  const queries = {
    commitments: useInfiniteQuery(history.queryOptions("commitments", scope)),
    mail: useInfiniteQuery(history.queryOptions("mail", scope)),
    memory: useInfiniteQuery(history.queryOptions("memory", scope)),
  };
  return {
    ...history,
    canOpenReminder: sidebar !== null,
    loadMore(section: HistorySection) {
      if (
        scope &&
        history.isCurrent(scope) &&
        queries[section].hasNextPage &&
        !queries[section].isFetching
      ) {
        void queries[section].fetchNextPage();
      }
    },
    async openReminder(
      reminderId: string,
      trigger: HTMLButtonElement | undefined
    ) {
      if (sidebar) {
        await history.openReminder(
          reminderId,
          trigger,
          sidebar.onOpenReminders
        );
      }
    },
    queries,
    retrySection(section: HistorySection) {
      if (scope && history.isCurrent(scope) && !queries[section].isFetching) {
        if (queries[section].isFetchNextPageError) {
          void queries[section].fetchNextPage();
        } else {
          void queries[section].refetch();
        }
      }
    },
    sessionEnded: snapshot.sessionEnded || !ownsCurrentInputs,
    view,
  };
};
