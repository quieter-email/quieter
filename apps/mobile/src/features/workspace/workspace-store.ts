import type { MailCategory } from "@quieter/mail/data-plane";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Store, useSelector } from "@tanstack/react-store";

import { ignoreFailure } from "#/lib/async";

type WorkspaceState = {
  category: MailCategory;
  isDrawerOpen: boolean;
  mailboxId: string | null;
  searchQuery: string;
};

const MAILBOX_STORAGE_KEY = "quieter.workspace.mailbox-id";

export const workspaceStore = new Store<WorkspaceState>({
  category: "inbox",
  isDrawerOpen: false,
  mailboxId: null,
  searchQuery: "",
});

export const setDrawerOpen = (isDrawerOpen: boolean) => {
  workspaceStore.setState((state) => ({ ...state, isDrawerOpen }));
};

export const setMailboxCategory = (category: MailCategory) => {
  workspaceStore.setState((state) => ({ ...state, category }));
};

export const setSelectedMailboxId = (mailboxId: string) => {
  workspaceStore.setState((state) => ({
    ...state,
    isDrawerOpen: false,
    mailboxId,
  }));
  void ignoreFailure(AsyncStorage.setItem(MAILBOX_STORAGE_KEY, mailboxId));
};

export const setSearchQuery = (searchQuery: string) => {
  workspaceStore.setState((state) => ({ ...state, searchQuery }));
};

export const hydrateWorkspaceMailboxId = async () => {
  try {
    const stored = await AsyncStorage.getItem(MAILBOX_STORAGE_KEY);
    if (stored !== null && stored.length > 0) {
      workspaceStore.setState((state) => ({ ...state, mailboxId: stored }));
    }
  } catch {
    // A missing stored mailbox just falls back to the default mailbox.
  }
};

export const useWorkspaceState = () =>
  useSelector(workspaceStore, (state) => state);

export const useSelectedMailboxId = () =>
  useSelector(workspaceStore, (state) => state.mailboxId);

export const useMailboxCategory = () =>
  useSelector(workspaceStore, (state) => state.category);

export const useWorkspaceSearchQuery = () =>
  useSelector(workspaceStore, (state) => state.searchQuery);

export const useIsDrawerOpen = () =>
  useSelector(workspaceStore, (state) => state.isDrawerOpen);
