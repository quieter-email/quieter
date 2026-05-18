"use client";

import { useRef, useState } from "react";
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
  const pendingMessageActionIdsRef = useRef(pendingMessageActionIds);
  const pendingThreadActionIdsRef = useRef(pendingThreadActionIds);

  pendingMessageActionIdsRef.current = pendingMessageActionIds;
  pendingThreadActionIdsRef.current = pendingThreadActionIds;

  const pendingActions: MailboxPendingActions = {
    isMessageActionPending: (id) => (id ? pendingMessageActionIds.has(id) : false),
    isThreadActionPending: (id) => (id ? pendingThreadActionIds.has(id) : false),
  };

  const setMessageActionsPending = (ids: string[], pending: boolean) => {
    if (ids.length === 0) return;

    setPendingMessageActionIds((current) => {
      const next = updatePendingIds(current, ids, pending);
      pendingMessageActionIdsRef.current = next;
      return next;
    });
  };

  const setThreadActionsPending = (ids: string[], pending: boolean) => {
    if (ids.length === 0) return;

    setPendingThreadActionIds((current) => {
      const next = updatePendingIds(current, ids, pending);
      pendingThreadActionIdsRef.current = next;
      return next;
    });
  };

  return {
    pendingActions,
    pendingMessageActionIdsRef,
    pendingThreadActionIdsRef,
    setMessageActionsPending,
    setThreadActionsPending,
  };
};
