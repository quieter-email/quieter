import type { RouterOutputs } from "@quieter/orpc";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  getMailboxesQueryKey,
  mailboxesQueryOptions,
} from "#/lib/mailboxes-query";
import { usePreviewPersona } from "#/lib/preview-personas";

import { MailSyncSession, runMailSyncTask } from "./session";

let previousStop = Promise.resolve();

export const MailSyncProvider = ({
  userId,
}: {
  userId: string | undefined;
}) => {
  const queryClient = useQueryClient();
  const previewPersona = usePreviewPersona();
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- The cleanup aborts startup, removes listeners, unsubscribes the query observer, and stops the worker.
  useEffect((): (() => void) | undefined => {
    if (userId === undefined || previewPersona !== null) {
      return undefined;
    }
    const controller = new AbortController();
    let session: MailSyncSession | null = null;
    let unsubscribe: (() => void) | null = null;
    let lastMailboxIds = "";
    let updatingMailboxes = false;
    let mailboxUpdatePending = false;
    const visibility = () => {
      void runMailSyncTask(
        session?.client.action({
          input: document.visibilityState === "visible",
          method: "visible",
        })
      );
    };
    const connectivity = () => {
      void runMailSyncTask(
        session?.client.action({ input: navigator.onLine, method: "online" })
      );
    };
    const updateMailboxes = async () => {
      if (controller.signal.aborted) {
        return;
      }
      if (updatingMailboxes) {
        mailboxUpdatePending = true;
        return;
      }
      mailboxUpdatePending = false;
      const data = queryClient.getQueryData<
        RouterOutputs["mail"]["listMailboxes"]
      >(getMailboxesQueryKey());
      if (data === undefined || session === null) {
        return;
      }
      const mailboxes = data.groups
        .flatMap((group) => group.mailboxes)
        .flatMap((mailbox) =>
          mailbox.provider === "gmail" || mailbox.provider === "managed"
            ? [{ id: mailbox.id, provider: mailbox.provider }]
            : []
        );
      const identity = JSON.stringify(mailboxes);
      if (identity === lastMailboxIds) {
        return;
      }
      updatingMailboxes = true;
      try {
        await session.subscribe(mailboxes);
        lastMailboxIds = identity;
      } finally {
        updatingMailboxes = false;
        if (mailboxUpdatePending) {
          void runMailSyncTask(updateMailboxes());
        }
      }
    };
    const start = async () => {
      await previousStop;
      controller.signal.throwIfAborted();
      session = MailSyncSession.start(userId, queryClient);
      await session.client.ready;
      if (controller.signal.aborted) {
        return;
      }
      visibility();
      connectivity();
      unsubscribe = queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === "updated" &&
          event.query.queryHash === JSON.stringify(getMailboxesQueryKey())
        ) {
          void runMailSyncTask(updateMailboxes());
        }
      });
      await queryClient.ensureQueryData(mailboxesQueryOptions());
      await updateMailboxes();
    };
    void runMailSyncTask(start());
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    return () => {
      controller.abort();
      unsubscribe?.();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      previousStop =
        session === null ? previousStop : runMailSyncTask(session.stop(true));
    };
  }, [previewPersona, queryClient, userId]);
  return null;
};
