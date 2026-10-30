import { hasComposeDraftContent } from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { authClient } from "@quieter/app/lib/auth";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { toastError } from "@quieter/app/lib/error-toast";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef, useState } from "react";

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
  const session = authClient.useSession().data;
  // oxlint-disable-next-line react/hook-use-state -- Ownership is fixed until the session-keyed provider remounts.
  const [owner] = useState(() => ({
    sessionId: session?.session.id,
    userId: session?.user.id,
  }));
  const { userId } = owner;
  // oxlint-disable-next-line react/hook-use-state -- The session capability stays fixed for this editor lifetime.
  const [recovery] = useState(() =>
    draftRecoveryJournal.session(userId ?? "", owner.sessionId)
  );
  const editorId = useRef(crypto.randomUUID());
  const completed = useRef(false);
  const warned = useRef(false);

  useEffect((): (() => void) | undefined => {
    if (!enabled || mailboxId === null || userId === undefined) {
      return undefined;
    }
    const unregister = recovery.registerEditor({
      editorId: editorId.current,
      mailboxId,
      userId,
    });
    void queryClient.invalidateQueries({
      queryKey: ["local-draft-recovery", userId, mailboxId],
    });
    return () => {
      unregister();
      void queryClient.invalidateQueries({
        queryKey: ["local-draft-recovery", userId, mailboxId],
      });
    };
  }, [enabled, mailboxId, queryClient, recovery, userId]);

  const reportCheckpointError = (error: unknown) => {
    if (!warned.current) {
      warned.current = true;
      toastError(error, {
        boundary: "compose-recovery",
        fallback:
          "This browser could not keep a recovery copy. Keep this draft open until it is saved.",
      });
    }
  };

  const checkpoint = () => {
    if (
      !enabled ||
      completed.current ||
      mailboxId === null ||
      userId === undefined
    ) {
      return;
    }
    const draft = getDraft();
    void (async () => {
      try {
        if (hasComposeDraftContent(draft) || !!draft.draftId) {
          await recovery.save({
            editorId: editorId.current,
            localId: draft.localId,
            mailboxId,
            payload: JSON.stringify(draft),
            updatedAt: Date.now(),
            userId,
          });
        } else {
          await recovery.remove({
            editorId: editorId.current,
            localId: draft.localId,
            mailboxId,
            userId,
          });
        }
      } catch (error) {
        reportCheckpointError(error);
      }
    })();
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
      if (mailboxId === null || userId === undefined) {
        return;
      }
      try {
        for (const record of await recovery.list({ mailboxId, userId })) {
          if (
            (record.localId === draft.localId &&
              record.editorId === editorId.current) ||
            (record.localId === (draft.recoveryLocalId ?? draft.localId) &&
              record.editorId === draft.recoveryEditorId &&
              record.revision === draft.recoveryRevision)
          ) {
            await recovery.remove(record);
          }
        }
        await queryClient.invalidateQueries({
          queryKey: ["local-draft-recovery", userId, mailboxId],
        });
      } catch (error) {
        toastError(error, { boundary: "compose-recovery-cleanup" });
      }
    },
  };
};
