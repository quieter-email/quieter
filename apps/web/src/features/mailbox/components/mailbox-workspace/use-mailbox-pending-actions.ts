"use client";

import { useCallback, useMemo, useState } from "react";
import type { MailboxPendingActions } from "../mailbox-action-handlers";

const updatePendingIds = (
  current: ReadonlySet<string>,
  ids: readonly string[],
  pending: boolean,
): ReadonlySet<string> => {
  const next = new Set(current);
  let changed = false;

  for (const id of ids) {
    if (pending) {
      changed ||= !next.has(id);
      next.add(id);
    } else {
      changed ||= next.has(id);
      next.delete(id);
    }
  }

  return changed ? next : current;
};

export const useMailboxPendingActions = () => {
  const [pendingMessageActionIds, setPendingMessageActionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingThreadActionIds, setPendingThreadActionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const isMessageActionPending = useCallback(
    (id: string | null | undefined) => (id ? pendingMessageActionIds.has(id) : false),
    [pendingMessageActionIds],
  );
  const isThreadActionPending = useCallback(
    (id: string | null | undefined) => (id ? pendingThreadActionIds.has(id) : false),
    [pendingThreadActionIds],
  );
  const pendingActions: MailboxPendingActions = useMemo(
    () => ({
      isMessageActionPending,
      isThreadActionPending,
    }),
    [isMessageActionPending, isThreadActionPending],
  );

  const setMessageActionsPending = useCallback((ids: string[], pending: boolean) => {
    if (ids.length === 0) return;

    setPendingMessageActionIds((current) => {
      return updatePendingIds(current, ids, pending);
    });
  }, []);

  const setThreadActionsPending = useCallback((ids: string[], pending: boolean) => {
    if (ids.length === 0) return;

    setPendingThreadActionIds((current) => {
      return updatePendingIds(current, ids, pending);
    });
  }, []);

  return {
    pendingActions,
    isMessageActionPending,
    isThreadActionPending,
    setMessageActionsPending,
    setThreadActionsPending,
  };
};
