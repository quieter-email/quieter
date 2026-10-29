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
      className={
        className ??
        "rounded-sm underline underline-offset-2 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      }
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
