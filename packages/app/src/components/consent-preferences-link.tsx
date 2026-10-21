"use client";

import { useHeadlessConsentUI } from "@c15t/react/headless";
import { Button } from "@quieter/ui/button";
import type { ReactNode } from "react";

import { appRuntime } from "../runtime";

type ConsentPreferencesLinkProps = {
  children?: ReactNode;
  className?: string;
  tabIndex?: number;
  variant?: "link" | "button";
};

const BrowserConsentPreferencesLink = ({
  children = "Manage privacy preferences",
  className,
  tabIndex,
  variant = "link",
}: ConsentPreferencesLinkProps) => {
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

export const ConsentPreferencesLink = (props: ConsentPreferencesLinkProps) =>
  appRuntime.platform === "desktop" ? null : (
    <BrowserConsentPreferencesLink {...props} />
  );
