"use client";

import type {
  useMailboxOrganizerState,
  useMailboxOrganizerController,
} from "./mailbox-organizer-state";

export type MailboxOrganizerProps = {
  canManage: boolean;
  mailboxId: string;
  searchQuery: string;
};

export type PendingRowAction = "backfill" | "delete" | "update";

export type RuleActionKind = "forward" | "move" | "set-labels" | "set-read";

export type RuleMatchMode = "all" | "any";

export type RuleMoveDestination = "archive" | "inbox" | "spam" | "trash";

export type MailboxOrganizerState = ReturnType<typeof useMailboxOrganizerState>;

type MailboxOrganizerController = ReturnType<
  typeof useMailboxOrganizerController
>;

export type MailboxOrganizerContentProps = MailboxOrganizerProps &
  MailboxOrganizerController;
