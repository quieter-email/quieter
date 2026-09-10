import { useEffect, useEffectEvent } from "react";

import { MailSyncSession, runMailSyncTask } from "#/lib/mail-sync/session";

export const useDraftAutosave = ({
  mailboxId,
  enabled,
  save,
  subscribe,
}: {
  mailboxId: string | null;
  enabled: boolean;
  save: () => Promise<void>;
  subscribe: (changed: () => void) => { unsubscribe: () => void };
}) => {
  const persist = useEffectEvent(async () => {
    if (
      mailboxId !== null &&
      MailSyncSession.forMailbox(mailboxId) !== null &&
      navigator.onLine
    ) {
      await save();
    }
  });
  useEffect((): (() => void) | undefined => {
    if (!enabled) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void runMailSyncTask(persist());
      }, 1500);
    };
    const subscription = subscribe(changed);
    // A change during an in-flight save must be reconsidered after that save finishes.
    const retry = setInterval(changed, 10_000);
    return () => {
      clearTimeout(timer);
      clearInterval(retry);
      subscription.unsubscribe();
    };
  }, [enabled, subscribe]);
};
