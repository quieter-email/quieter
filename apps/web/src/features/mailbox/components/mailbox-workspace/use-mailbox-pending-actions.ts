"use client";

import { useState } from "react";
import type { MailboxPendingActions } from "../mailbox-action-handlers";

const updatePendingIds = (
  current: ReadonlySet<string>,
  ids: readonly string[],
  pending: boolean,
): ReadonlySet<string> => {
  const next = new Set(current);

  for (const id of ids) {
    if (pending) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }

  return next;
};

export const useMailboxPendingActions = () => {
  const [pendingMessageActionIds, setPendingMessageActionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingThreadActionIds, setPendingThreadActionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const pendingActions: MailboxPendingActions = {
    isMessageActionPending: (id) => (id ? pendingMessageActionIds.has(id) : false),
    isThreadActionPending: (id) => (id ? pendingThreadActionIds.has(id) : false),
  };

  const setMessageActionsPending = (ids: string[], pending: boolean) => {
    if (ids.length === 0) return;

    setPendingMessageActionIds((current) => {
      return updatePendingIds(current, ids, pending);
    });
  };

  const setThreadActionsPending = (ids: string[], pending: boolean) => {
    if (ids.length === 0) return;

    setPendingThreadActionIds((current) => {
      return updatePendingIds(current, ids, pending);
    });
  };

  return {
    pendingActions,
    isMessageActionPending: pendingActions.isMessageActionPending,
    isThreadActionPending: pendingActions.isThreadActionPending,
    setMessageActionsPending,
    setThreadActionsPending,
  };
};
