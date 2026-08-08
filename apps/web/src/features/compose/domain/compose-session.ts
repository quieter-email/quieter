import type { MailboxCategory } from "~/lib/gmail/gmail";
import type { ComposeDraftState } from "../domain/draft";

export type PendingComposeSession = {
  draft: ComposeDraftState | null;
  returnMailbox: MailboxCategory;
};

let pendingComposeSession: PendingComposeSession | null = null;

export const setPendingComposeSession = (session: PendingComposeSession) => {
  pendingComposeSession = session;
};

export const takePendingComposeSession = () => {
  const session = pendingComposeSession;
  pendingComposeSession = null;
  return session;
};
