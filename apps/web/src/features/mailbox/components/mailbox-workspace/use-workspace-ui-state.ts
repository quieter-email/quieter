"use client";

import { type SetStateAction, useEffect, useState } from "react";

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

  useEffect(() => {
    const updateWindowActivity = () => {
      const isWindowActive = document.visibilityState === "visible" && document.hasFocus();

      setWorkspaceUi((current) =>
        current.isWindowActive === isWindowActive ? current : { ...current, isWindowActive },
      );
    };

    updateWindowActivity();
    window.addEventListener("focus", updateWindowActivity);
    window.addEventListener("blur", updateWindowActivity);
    document.addEventListener("visibilitychange", updateWindowActivity);

    return () => {
      window.removeEventListener("focus", updateWindowActivity);
      window.removeEventListener("blur", updateWindowActivity);
      document.removeEventListener("visibilitychange", updateWindowActivity);
    };
  }, []);

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

  return {
    ...workspaceUi,
    setIsManualRefreshing,
    setIsMobileSidebarOpen,
  };
};
