import { useEffect, useEffectEvent } from "react";

export const useDraftAutosave = ({
  attachments,
  mailboxId,
  enabled,
  save,
  subscribe,
}: {
  attachments: readonly { id: string }[];
  mailboxId: string | null;
  enabled: boolean;
  save: () => Promise<boolean>;
  subscribe: (changed: () => void) => { unsubscribe: () => void };
}) => {
  const persist = useEffectEvent(async () => {
    if (mailboxId !== null && navigator.onLine) {
      return await save();
    }
    return false;
  });
  const observe = useEffectEvent(subscribe);
  useEffect((): (() => void) | undefined => {
    if (!enabled) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    let running = false;
    let disposed = false;
    let retryDelay = 1500;
    const flush = async () => {
      if (running || disposed || !dirty) {
        return;
      }
      dirty = false;
      running = true;
      try {
        if (await persist()) {
          retryDelay = 1500;
        } else {
          dirty = true;
          retryDelay = Math.min(retryDelay * 2, 30_000);
        }
      } finally {
        running = false;
        if (dirty && !disposed) {
          clearTimeout(timer);
          timer = setTimeout(() => {
            void flush();
          }, retryDelay);
        }
      }
    };
    const changed = () => {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void flush();
      }, 1500);
    };
    const subscription = observe(changed);
    changed();
    window.addEventListener("online", changed);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("online", changed);
      subscription.unsubscribe();
    };
  }, [attachments, enabled, mailboxId]);
};
