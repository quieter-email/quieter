"use client";

import { useHeadlessConsentUI } from "@c15t/react";
import { Button } from "@quieter/ui/button";
import type { ReactNode } from "react";

export const ConsentPreferencesLink = ({
  children = "Manage privacy preferences",
  className,
  tabIndex,
  variant = "link",
}: {
  children?: ReactNode;
  className?: string;
  tabIndex?: number;
  variant?: "link" | "button";
}) => {
  const { openDialog } = useHeadlessConsentUI();

  if (variant === "button") {
    return (
      <Button
        className={className}
        onClick={openDialog}
        tabIndex={tabIndex}
        size="sm"
        variant="outline"
      >
        {children}
      </Button>
    );
  }

  return (
    <button
      className={className ?? "underline hover:text-fg"}
      onClick={openDialog}
      tabIndex={tabIndex}
      type="button"
    >
      {children}
    </button>
  );
};
