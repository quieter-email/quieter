import { useEffect, useEffectEvent } from "react";

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
    if (mailboxId !== null && navigator.onLine) {
      await save();
    }
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
    const flush = async () => {
      if (running || disposed || !dirty) {
        return;
      }
      dirty = false;
      running = true;
      try {
        await persist();
      } finally {
        running = false;
        if (dirty && !disposed) {
          clearTimeout(timer);
          timer = setTimeout(() => {
            void flush();
          }, 1500);
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
  }, [enabled, mailboxId]);
};
