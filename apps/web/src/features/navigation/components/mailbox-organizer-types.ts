"use client";

import type { RouterOutputs } from "@quieter/orpc";

import type {
  useMailboxOrganizerState,
  useMailboxOrganizerController,
} from "./mailbox-organizer-state";

export type MailboxOrganizerProps = {
  canManage: boolean;
  mailboxId: string;
  onSearch: (query: string) => void;
  searchQuery: string;
  supportsRules: boolean;
  supportsSharedViews: boolean;
};

export type MailboxSavedView = RouterOutputs["mail"]["listSavedViews"][number];

export type PendingRowKind = "rule" | "view";

export type PendingRowAction = "backfill" | "delete" | "duplicate" | "update";

export type ReorderScope = "rules" | "views:personal" | "views:shared";

export type RuleActionKind = "forward" | "move" | "set-labels" | "set-read";

export type RuleMatchMode = "all" | "any";

export type RuleMoveDestination = "archive" | "inbox" | "spam" | "trash";

export type MailboxOrganizerState = ReturnType<typeof useMailboxOrganizerState>;

type MailboxOrganizerController = ReturnType<
  typeof useMailboxOrganizerController
>;

export type MailboxOrganizerContentProps = MailboxOrganizerProps &
  MailboxOrganizerController;
