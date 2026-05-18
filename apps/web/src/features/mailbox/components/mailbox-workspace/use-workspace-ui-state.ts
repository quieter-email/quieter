"use client";

import { type SetStateAction, useState } from "react";

type WorkspaceUiState = {
  isManualRefreshing: boolean;
  isMobileSidebarOpen: boolean;
  isWindowActive: boolean;
};

const initialWorkspaceUiState: WorkspaceUiState = {
  isManualRefreshing: false,
  isMobileSidebarOpen: false,
  isWindowActive: false,
};

const resolveStateAction = <T>(action: SetStateAction<T>, current: T) =>
  typeof action === "function" ? (action as (current: T) => T)(current) : action;

export const useWorkspaceUiState = () => {
  const [workspaceUi, setWorkspaceUi] = useState<WorkspaceUiState>(initialWorkspaceUiState);

  const setIsManualRefreshing = (action: SetStateAction<boolean>) => {
    setWorkspaceUi((current) => ({
      ...current,
      isManualRefreshing: resolveStateAction(action, current.isManualRefreshing),
    }));
  };

  const setIsMobileSidebarOpen = (action: SetStateAction<boolean>) => {
    setWorkspaceUi((current) => ({
      ...current,
      isMobileSidebarOpen: resolveStateAction(action, current.isMobileSidebarOpen),
    }));
  };

  const setIsWindowActive = (action: SetStateAction<boolean>) => {
    setWorkspaceUi((current) => ({
      ...current,
      isWindowActive: resolveStateAction(action, current.isWindowActive),
    }));
  };

  return {
    ...workspaceUi,
    setIsManualRefreshing,
    setIsMobileSidebarOpen,
    setIsWindowActive,
  };
};
