"use client";

import { subscribeMailboxAccessLoss } from "@quieter/app/lib/mail-cache-lifecycle";
import { useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { useCreateStore, useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useId, useMemo } from "react";

import {
  initialNotesClientState,
  transitionNotesClient,
} from "./notes-session";
import type { NotesClientState } from "./notes-session";

type NotesAccessLoss = { mailboxId: string; threadId?: string };
const listeners = new WeakMap<
  QueryClient,
  Set<(loss: NotesAccessLoss) => void>
>();

export const useNotesSession = (
  input:
    | { mailboxId: string; threadId?: string }
    | {
        mailboxIds: readonly string[];
        onAccessLost: (loss: NotesAccessLoss) => void;
      }
) => {
  const mailboxId = "mailboxId" in input ? input.mailboxId : undefined;
  const threadId = "threadId" in input ? input.threadId : undefined;
  const supplied = "mailboxIds" in input ? input.mailboxIds : undefined;
  const onAccessLost = "onAccessLost" in input ? input.onAccessLost : undefined;
  const mailboxIds = useMemo(
    () => supplied ?? (mailboxId === undefined ? [] : [mailboxId]),
    [mailboxId, supplied]
  );
  const catalogue = JSON.stringify(mailboxIds);
  const queryClient = useQueryClient();
  const instanceId = useId();
  const store = useCreateStore<NotesClientState>(initialNotesClientState);
  const client = useSelector(store, (value) => value);
  const prefix = useMemo(
    () => [
      "collaboration-notes",
      mailboxId ?? "mentions",
      threadId ?? catalogue,
      instanceId,
    ],
    [catalogue, instanceId, mailboxId, threadId]
  );
  const restart = useCallback(
    (keepDraft: boolean) => {
      void queryClient.cancelQueries({ queryKey: prefix });
      queryClient.removeQueries({ queryKey: prefix });
      const available =
        navigator.onLine && document.visibilityState === "visible";
      store.setState((current) =>
        transitionNotesClient(current, {
          available,
          keepDraft,
          kind: "restart",
        })
      );
    },
    [prefix, queryClient, store]
  );
  const loseAccess = useCallback(
    (loss: NotesAccessLoss) => {
      const activeListeners = [...(listeners.get(queryClient) ?? [])];
      for (const listener of activeListeners) {
        listener(loss);
      }
    },
    [queryClient]
  );

  useEffect(() => {
    const recover = () => {
      restart(true);
    };
    const handleLoss = (loss: NotesAccessLoss) => {
      if (
        mailboxIds.includes(loss.mailboxId) &&
        (threadId === undefined ||
          loss.threadId === undefined ||
          loss.threadId === threadId)
      ) {
        if (onAccessLost === undefined) {
          void queryClient.cancelQueries({ queryKey: prefix });
          queryClient.removeQueries({ queryKey: prefix });
          store.setState((current) => {
            const closed = transitionNotesClient(current, {
              available: false,
              keepDraft: false,
              kind: "restart",
            });
            return transitionNotesClient(closed, {
              epoch: closed.epoch,
              failure: "lost",
              kind: "failed",
            });
          });
        } else {
          const key = [...prefix, "private", loss.mailboxId];
          void queryClient.cancelQueries({ queryKey: key });
          queryClient.removeQueries({ queryKey: key });
          onAccessLost(loss);
        }
      }
    };
    const activeListeners = listeners.get(queryClient) ?? new Set();
    activeListeners.add(handleLoss);
    listeners.set(queryClient, activeListeners);
    const stop = subscribeMailboxAccessLoss(queryClient, handleLoss);
    window.addEventListener("offline", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", recover);
    restart(true);
    return () => {
      stop();
      activeListeners.delete(handleLoss);
      window.removeEventListener("offline", recover);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", recover);
      void queryClient.cancelQueries({ queryKey: prefix });
      queryClient.removeQueries({ queryKey: prefix });
      store.setState((current) =>
        transitionNotesClient(current, {
          available: false,
          keepDraft: false,
          kind: "restart",
        })
      );
    };
  }, [mailboxIds, onAccessLost, prefix, queryClient, restart, store, threadId]);

  return { client, loseAccess, prefix, queryClient, restart, store };
};
