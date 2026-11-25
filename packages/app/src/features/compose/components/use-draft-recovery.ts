import { hasComposeDraftContent } from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { authClient } from "@quieter/app/lib/auth";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { toastError } from "@quieter/app/lib/error-toast";
import { useEffect, useEffectEvent, useRef, useState } from "react";

export const useDraftRecovery = ({
  mailboxId,
  enabled,
  getDraft,
  subscribe,
}: {
  mailboxId: string | null;
  enabled: boolean;
  getDraft: () => ComposeDraftState;
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
  const checkpointed = useRef(false);
  const retainingHeldEdits = useRef(false);
  const warned = useRef(false);

  useEffect((): (() => void) | undefined => {
    if (!enabled || mailboxId === null || userId === undefined) {
      return undefined;
    }
    return recovery.registerEditor({
      editorId: editorId.current,
      mailboxId,
      userId,
    });
  }, [enabled, mailboxId, recovery, userId]);

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
    if (
      !retainingHeldEdits.current &&
      draft.assistantUnsaved !== true &&
      draft.sendUncertain !== true &&
      draft.saveStatus !== "sending"
    ) {
      return;
    }
    checkpointed.current = true;
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

  const removeCheckpoints = async (
    draft: ComposeDraftState,
    isCurrent?: () => boolean
  ) => {
    if (mailboxId === null || userId === undefined) {
      return;
    }
    try {
      const records = await recovery.list({ mailboxId, userId });
      if (isCurrent?.() === false) {
        return;
      }
      for (const record of records) {
        if (
          (record.localId === draft.localId &&
            record.editorId === editorId.current) ||
          (record.localId === (draft.recoveryLocalId ?? draft.localId) &&
            record.editorId === draft.recoveryEditorId &&
            record.revision === draft.recoveryRevision)
        ) {
          await recovery.remove(record);
          if (isCurrent?.() === false) {
            return;
          }
        }
      }
    } catch (error) {
      toastError(error, { boundary: "compose-recovery-cleanup" });
    }
  };

  return {
    checkpoint,
    complete: async (draft: ComposeDraftState, isCurrent?: () => boolean) => {
      if (isCurrent === undefined) {
        completed.current = true;
      }
      await removeCheckpoints(draft, isCurrent);
      if (isCurrent?.() === true) {
        completed.current = true;
      }
    },
    markSaved: async (draft: ComposeDraftState, isCurrent: () => boolean) => {
      if (checkpointed.current || draft.recoveryEditorId !== undefined) {
        checkpointed.current = false;
        retainingHeldEdits.current = false;
        await removeCheckpoints(draft, isCurrent);
      }
    },
    preserveCopy: async (
      draft: ComposeDraftState,
      identity: { editorId: string; localId: string }
    ) => {
      if (
        mailboxId === null ||
        userId === undefined ||
        !(await recovery.ready())
      ) {
        throw new Error("This browser could not keep your newer draft edits.");
      }
      const scope = { mailboxId, userId };
      const records = await recovery.list(scope);
      const existing = records.find(
        (record) =>
          record.localId === identity.localId &&
          record.editorId === identity.editorId
      );
      if (existing) {
        return;
      }
      const payload = JSON.stringify({ ...draft, localId: identity.localId });
      await recovery.save({
        ...scope,
        ...identity,
        payload,
        updatedAt: Date.now(),
      });
      const savedRecords = await recovery.list(scope);
      const persisted = savedRecords.some(
        (record) =>
          record.localId === identity.localId &&
          record.editorId === identity.editorId &&
          record.payload === payload
      );
      if (!persisted) {
        throw new Error("This browser could not keep your newer draft edits.");
      }
    },
    retainHeldDraft: () => {
      completed.current = false;
      retainingHeldEdits.current = true;
      checkpoint();
    },
  };
};
