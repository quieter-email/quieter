"use client";

import { useHeadlessConsentUI } from "@c15t/react";
import type { ReactNode } from "react";

export const ConsentPreferencesLink = ({
  children = "Manage privacy preferences",
  className = "underline hover:text-fg",
  tabIndex,
}: {
  children?: ReactNode;
  className?: string;
  tabIndex?: number;
}) => {
  const { openDialog } = useHeadlessConsentUI();

  return (
    <button
      className={className}
      onClick={openDialog}
      tabIndex={tabIndex}
      type="button"
    >
      {children}
    </button>
  );
};
