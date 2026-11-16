import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import type { MailboxSyncDelta } from "@quieter/mail/messages";

import { loadOwnedOutlookCredential } from "./auth";
import { getOwnedOutlookMailbox } from "./mailbox-state";
import { syncOutlookMailbox } from "./sync";

export const getOutlookMailboxSyncDelta = async (input: {
  mailboxId: string;
  signal?: AbortSignal;
  startHistoryId: string;
  userId: string;
}): Promise<MailboxSyncDelta> => {
  const ownership = await loadOwnedOutlookCredential(input);
  const mailboxHash = createHash("sha256")
    .update(input.mailboxId)
    .digest("hex");
  const token =
    /^outlook:(?<hash>[a-f\d]{64}):(?<generation>\d+):(?<revision>\d+)$/u.exec(
      input.startHistoryId
    );
  const generation = Number(token?.groups?.generation);
  const revision = Number(token?.groups?.revision);
  if (
    token?.groups?.hash !== mailboxHash ||
    !Number.isSafeInteger(generation) ||
    !Number.isSafeInteger(revision)
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The mailbox sync token is invalid. Refresh to continue.",
    });
  }
  if (
    ownership.credential.status !== "connected" ||
    ownership.mailboxStatus !== "connected"
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Reconnect this mailbox before using it.",
    });
  }
  const slice =
    generation === ownership.credential.generation
      ? await syncOutlookMailbox(input)
      : { kind: "reconcile" as const };
  const [current, latest] = await Promise.all([
    getOwnedOutlookMailbox(input),
    loadOwnedOutlookCredential(input),
  ]);
  if (current === null) {
    throw new ORPCError("NOT_FOUND", { message: "Mailbox not found." });
  }
  if (
    latest.credential.status !== "connected" ||
    latest.mailboxStatus !== "connected"
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Reconnect this mailbox before using it.",
    });
  }
  const hasChanges =
    slice.kind === "reconcile" ||
    generation !== latest.credential.generation ||
    revision !== current.contentRevision;
  return {
    hasChanges,
    historyId: `outlook:${mailboxHash}:${latest.credential.generation}:${current.contentRevision}`,
    refreshFirstPage: hasChanges,
    removedMessageIds: [],
    requiresFullRefresh: hasChanges,
    updatedMessages: [],
  };
};
