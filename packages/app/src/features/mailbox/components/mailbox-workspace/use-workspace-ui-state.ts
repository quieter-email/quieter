"use client";

import { useCallback, useState } from "react";
import type { SetStateAction } from "react";

export const useWorkspaceUiState = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const updateMobileSidebarOpen = useCallback(
    (action: SetStateAction<boolean>) => {
      setIsMobileSidebarOpen((current) => {
        const next = typeof action === "function" ? action(current) : action;
        return current === next ? current : next;
      });
    },
    []
  );

  return {
    isMobileSidebarOpen,
    setIsMobileSidebarOpen: updateMobileSidebarOpen,
  };
};
