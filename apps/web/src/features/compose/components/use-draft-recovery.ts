import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";

import { draftRecoveryJournal } from "#/lib/draft-recovery-journal";
import { toastError } from "#/lib/error-toast";

import { hasComposeDraftContent } from "../domain/draft";
import type { ComposeDraftState } from "../domain/draft";

export const useDraftRecovery = ({
  mailboxId,
  enabled,
  getDraft,
  queryClient,
  subscribe,
}: {
  mailboxId: string | null;
  enabled: boolean;
  getDraft: () => ComposeDraftState;
  queryClient: QueryClient;
  subscribe: (onChange: () => void) => { unsubscribe: () => void };
}) => {
  const editorId = useRef(crypto.randomUUID());
  const completed = useRef(false);
  const warned = useRef(false);

  const checkpoint = () => {
    if (!enabled || completed.current || mailboxId === null) {
      return;
    }
    const draft = getDraft();
    try {
      if (hasComposeDraftContent(draft)) {
        draftRecoveryJournal.save({
          editorId: editorId.current,
          localId: draft.localId,
          mailboxId,
          payload: JSON.stringify(draft),
          updatedAt: Date.now(),
        });
      } else {
        draftRecoveryJournal.remove({
          editorId: editorId.current,
          localId: draft.localId,
          mailboxId,
        });
      }
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        toastError(error, {
          boundary: "compose-recovery",
          fallback:
            "This browser could not keep a recovery copy. Keep this draft open until it is saved.",
        });
      }
    }
  };
  const persist = useEffectEvent(() => {
    checkpoint();
  });

  useEffect((): (() => void) | undefined => {
    if (!enabled) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        persist();
      }, 300);
    });
    const flush = () => {
      clearTimeout(timer);
      persist();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, [enabled, subscribe]);

  return {
    checkpoint,
    complete: async (draft: ComposeDraftState) => {
      completed.current = true;
      if (mailboxId === null) {
        return;
      }
      for (const record of draftRecoveryJournal.list(mailboxId)) {
        if (
          record.localId === draft.localId &&
          (record.editorId === editorId.current ||
            (record.editorId === draft.recoveryEditorId &&
              record.updatedAt <= (draft.recoveryUpdatedAt ?? 0)))
        ) {
          draftRecoveryJournal.remove(record);
        }
      }
      await queryClient.invalidateQueries({
        queryKey: ["local-draft-recovery", mailboxId],
      });
    },
  };
};
