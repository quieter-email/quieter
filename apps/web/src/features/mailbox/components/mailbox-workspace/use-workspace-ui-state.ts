"use client";

import { type SetStateAction, useCallback, useState } from "react";

const resolveStateAction = <T>(action: SetStateAction<T>, current: T) =>
  typeof action === "function" ? (action as (current: T) => T)(current) : action;

export const useWorkspaceUiState = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpenState] = useState(false);

  const setIsMobileSidebarOpen = useCallback((action: SetStateAction<boolean>) => {
    setIsMobileSidebarOpenState((current) => {
      const next = resolveStateAction(action, current);
      return current === next ? current : next;
    });
  }, []);

  return {
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
  };
};
