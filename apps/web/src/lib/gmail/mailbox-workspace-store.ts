import { createStore } from "@tanstack/store";

export type MailboxWorkspaceStoreState = {
  isManualRefreshing: boolean;
  isWindowActive: boolean;
  pendingMessageActionIds: ReadonlySet<string>;
  pendingThreadActionIds: ReadonlySet<string>;
};

const updatePendingIds = (
  current: ReadonlySet<string>,
  ids: readonly string[],
  pending: boolean,
): ReadonlySet<string> => {
  const next = new Set(current);

  for (const id of ids) {
    if (pending) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }

  return next;
};

export const createInitialMailboxWorkspaceStoreState = (): MailboxWorkspaceStoreState => ({
  isManualRefreshing: false,
  isWindowActive: false,
  pendingMessageActionIds: new Set(),
  pendingThreadActionIds: new Set(),
});

export const createMailboxWorkspaceStore = () =>
  createStore(createInitialMailboxWorkspaceStoreState());

export type MailboxWorkspaceStore = ReturnType<typeof createMailboxWorkspaceStore>;

export const isMessageActionPending = (
  store: MailboxWorkspaceStore,
  messageId: string | null | undefined,
) => (messageId ? store.state.pendingMessageActionIds.has(messageId) : false);

export const isThreadActionPending = (
  store: MailboxWorkspaceStore,
  threadId: string | null | undefined,
) => (threadId ? store.state.pendingThreadActionIds.has(threadId) : false);

export const setMailboxWorkspaceManualRefreshing = (
  store: MailboxWorkspaceStore,
  value: boolean,
) => {
  store.setState((state) => ({
    ...state,
    isManualRefreshing: value,
  }));
};

export const setMailboxWorkspaceWindowActive = (store: MailboxWorkspaceStore, value: boolean) => {
  store.setState((state) => ({
    ...state,
    isWindowActive: value,
  }));
};

export const setMailboxWorkspaceMessagePending = (
  store: MailboxWorkspaceStore,
  messageId: string,
  pending: boolean,
) => {
  store.setState((state) => ({
    ...state,
    pendingMessageActionIds: updatePendingIds(state.pendingMessageActionIds, [messageId], pending),
  }));
};

export const setMailboxWorkspaceMessagesPending = (
  store: MailboxWorkspaceStore,
  messageIds: string[],
  pending: boolean,
) => {
  if (messageIds.length === 0) return;

  store.setState((state) => ({
    ...state,
    pendingMessageActionIds: updatePendingIds(state.pendingMessageActionIds, messageIds, pending),
  }));
};

export const setMailboxWorkspaceThreadPending = (
  store: MailboxWorkspaceStore,
  threadId: string,
  pending: boolean,
) => {
  store.setState((state) => ({
    ...state,
    pendingThreadActionIds: updatePendingIds(state.pendingThreadActionIds, [threadId], pending),
  }));
};

export const setMailboxWorkspaceThreadsPending = (
  store: MailboxWorkspaceStore,
  threadIds: string[],
  pending: boolean,
) => {
  if (threadIds.length === 0) return;

  store.setState((state) => ({
    ...state,
    pendingThreadActionIds: updatePendingIds(state.pendingThreadActionIds, threadIds, pending),
  }));
};
