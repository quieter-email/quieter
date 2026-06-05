"use client";

import { type SetStateAction, useCallback, useState } from "react";

export const useWorkspaceUiState = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpenState] = useState(false);

  const setIsMobileSidebarOpen = useCallback((action: SetStateAction<boolean>) => {
    setIsMobileSidebarOpenState((current) => {
      const next = typeof action === "function" ? action(current) : action;
      return current === next ? current : next;
    });
  }, []);

  return {
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
  };
};
