import type { LocalDraftRecord } from "@quieter/sync-client/draft-journal";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef } from "react";

import { toastError } from "#/lib/error-toast";
import { MailSyncSession, reportMailSyncError } from "#/lib/mail-sync/session";

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
  const pending = useRef(Promise.resolve());
  const checkpoint = async () => {
    const session =
      mailboxId === null ? null : MailSyncSession.forMailbox(mailboxId);
    if (
      !enabled ||
      completed.current ||
      mailboxId === null ||
      session === null
    ) {
      return;
    }
    const draft = getDraft();
    const record: LocalDraftRecord = {
      editorId: editorId.current,
      localId: draft.localId,
      mailboxId,
      payload: JSON.stringify(draft),
      updatedAt: Date.now(),
    };
    const previous = pending.current;
    pending.current = (async () => {
      try {
        await previous;
        const journal = await session.drafts;
        if (journal === null) {
          throw new Error("Draft recovery storage is unavailable.");
        }
        if (hasComposeDraftContent(draft)) {
          await journal.save(record);
        } else {
          await journal.remove(record);
        }
      } catch (error) {
        reportMailSyncError(error);
        if (
          !warned.current &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          warned.current = true;
          toastError(error, {
            boundary: "compose-recovery",
            fallback:
              "This browser could not keep a recovery copy. Keep this draft open until it is saved.",
          });
        }
      }
    })();
    await pending.current;
  };
  const persist = useEffectEvent(() => {
    void checkpoint();
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
      await pending.current;
      if (mailboxId === null) {
        return;
      }
      const journal = await MailSyncSession.forMailbox(mailboxId)?.drafts;
      const records = (await journal?.list(mailboxId)) ?? [];
      await Promise.all(
        records
          .filter(
            (record) =>
              record.localId === draft.localId &&
              (record.editorId === editorId.current ||
                record.editorId === draft.recoveryEditorId)
          )
          .map(async (record) => await journal?.remove(record))
      );
      await queryClient.invalidateQueries({
        queryKey: ["local-draft-recovery", mailboxId],
      });
    },
  };
};
