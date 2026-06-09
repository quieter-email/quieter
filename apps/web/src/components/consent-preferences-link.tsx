"use client";

import { ConsentDialogLink } from "@c15t/react";

export const ConsentPreferencesLink = ({
  className = "underline hover:text-foreground",
}: {
  className?: string;
}) => <ConsentDialogLink className={className}>Manage privacy preferences</ConsentDialogLink>;
