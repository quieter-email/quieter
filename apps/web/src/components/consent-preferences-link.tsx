"use client";

import type { ReactNode } from "react";
import { useHeadlessConsentUI } from "@c15t/react";

export const ConsentPreferencesLink = ({
  children = "Manage privacy preferences",
  className = "underline hover:text-foreground",
  tabIndex,
}: {
  children?: ReactNode;
  className?: string;
  tabIndex?: number;
}) => {
  const { openDialog } = useHeadlessConsentUI();

  return (
    <button className={className} onClick={openDialog} tabIndex={tabIndex} type="button">
      {children}
    </button>
  );
};
