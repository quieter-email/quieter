"use client";

import type { RouterOutputs } from "@quieter/orpc";

export type MailboxActionListItem =
  RouterOutputs["mailboxActions"]["list"]["actions"][number];

export type MailboxActionDetail =
  RouterOutputs["mailboxActions"]["get"]["action"];

export type MailboxActionRevision =
  RouterOutputs["mailboxActions"]["get"]["revisions"][number];

export type ConnectorsData = RouterOutputs["connectors"]["list"];

export type ConnectorProvider =
  NonNullable<ConnectorsData>["connectors"][number]["provider"];
