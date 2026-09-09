import { useSelector } from "@tanstack/react-store";
import { useEffect } from "react";
import { z } from "zod";

import { MailSyncSession, mailSyncState, runMailSyncTask } from "./session";

export const useMailSyncEnabled = (mailboxId: string) =>
  useSelector(
    mailSyncState,
    (state) =>
      state.mailboxIds.includes(mailboxId) &&
      state.status?.connection !== "disabled"
  );

export const useWarmMailThreads = (
  mailboxId: string,
  threadIds: string[],
  priority = 1
) => {
  const enabled = useMailSyncEnabled(mailboxId);
  const ids = JSON.stringify([...new Set(threadIds)].slice(0, 60));
  useEffect((): (() => void) | undefined => {
    const session = MailSyncSession.forMailbox(mailboxId);
    if (!enabled || session === null) {
      return undefined;
    }
    const parsed = z.array(z.string()).parse(JSON.parse(ids));
    if (priority === 0) {
      void runMailSyncTask(
        session.client.action({
          input: { mailboxId, threadIds: parsed },
          method: "pin",
        })
      );
      return () => {
        void runMailSyncTask(
          session.client.action({
            input: { mailboxId, threadIds: [] },
            method: "pin",
          })
        );
      };
    }
    session.warm(mailboxId, parsed, priority);
    return undefined;
  }, [enabled, ids, mailboxId, priority]);
};
