"use client";

import type { ReactNode } from "react";
import { useHeadlessConsentUI } from "@c15t/react";

export const ConsentPreferencesLink = ({
  children = "Manage privacy preferences",
  className = "underline hover:text-foreground",
}: {
  children?: ReactNode;
  className?: string;
}) => {
  const { openDialog } = useHeadlessConsentUI();

  return (
    <button className={className} onClick={openDialog} type="button">
      {children}
    </button>
  );
};
