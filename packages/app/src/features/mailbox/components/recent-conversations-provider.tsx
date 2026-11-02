"use client";

import { createRecentConversations } from "@quieter/app/features/mailbox/domain/recent-conversations";
import { useDemoModeEnabled } from "@quieter/app/features/settings/domain/demo-mode-setting";
import { useManagedDemoModeEnabled } from "@quieter/app/features/settings/domain/managed-demo-mode-setting";
import type { getDemoMailboxes } from "@quieter/app/lib/gmail/demo-mail";
import { subscribeMailboxAccessLoss } from "@quieter/app/lib/mail-cache-lifecycle";
import { getMailboxSelectionQueryKey } from "@quieter/app/lib/mailboxes-query";
import type { getManagedDemoMailboxes } from "@quieter/app/lib/managed-mail/demo-managed-mail";
import { usePreviewPersona } from "@quieter/app/lib/preview-personas";
import { subscribeQuerySessionInvalidation } from "@quieter/app/lib/query-persister";
import type { RouterOutputs } from "@quieter/orpc";
import type { QueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { PropsWithChildren } from "react";

const RecentConversationsContext = createContext<ReturnType<
  typeof createRecentConversations
> | null>(null);

export const RecentConversationsProvider = ({
  children,
  client,
  authenticated,
}: PropsWithChildren<{ client: QueryClient; authenticated: boolean }>) => {
  // oxlint-disable-next-line react/hook-use-state -- One private owner for the authenticated session provider lifetime.
  const [history] = useState(createRecentConversations);
  const isDemoMode = useDemoModeEnabled();
  const isManagedDemoMode = useManagedDemoModeEnabled();
  const previewPersona = usePreviewPersona();
  useLayoutEffect(() => {
    const queryKey = getMailboxSelectionQueryKey({
      isDemoMode,
      isEmptyPreviewPersona: previewPersona === "empty",
      isManagedDemoMode,
    });
    const updateMailboxes = () => {
      const query = client.getQueryState<
        | RouterOutputs["mail"]["listMailboxes"]
        | ReturnType<typeof getDemoMailboxes>
        | ReturnType<typeof getManagedDemoMailboxes>
      >(queryKey);
      const mailboxes =
        (query?.dataUpdatedAt ?? 0) > 0 ? query?.data : undefined;
      history.authorize(
        authenticated && mailboxes
          ? new Set(
              mailboxes.groups.flatMap((group) =>
                group.mailboxes.flatMap((mailbox) =>
                  mailbox.connectionStatus === "connected" ? [mailbox.id] : []
                )
              )
            )
          : undefined
      );
    };
    const unsubscribeSession = subscribeQuerySessionInvalidation(client, () => {
      history.revoke();
    });
    const unsubscribeAccess = subscribeMailboxAccessLoss(client, (loss) => {
      history.loseAccess(loss);
    });
    const unsubscribeCache = client.getQueryCache().subscribe((event) => {
      const key: unknown = event.query.queryKey;
      if (
        Array.isArray(key) &&
        JSON.stringify(key) === JSON.stringify(queryKey)
      ) {
        updateMailboxes();
      }
    });
    updateMailboxes();
    return () => {
      unsubscribeSession();
      unsubscribeAccess();
      unsubscribeCache();
    };
  }, [
    authenticated,
    client,
    history,
    isDemoMode,
    isManagedDemoMode,
    previewPersona,
  ]);
  return (
    <RecentConversationsContext value={history}>
      {children}
    </RecentConversationsContext>
  );
};

export const useRecordRecentConversation = () =>
  useContext(RecentConversationsContext)?.recordOpened;

export const useRecentConversations = () => {
  const history = useContext(RecentConversationsContext);
  const subscribe = useCallback(
    (notify: () => void) => {
      const subscription = history?.state.subscribe(notify);
      return () => {
        subscription?.unsubscribe();
      };
    },
    [history]
  );
  const snapshot = useCallback(() => history?.state.get() ?? null, [history]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => {
    const mailboxIds =
      state?.phase === "active"
        ? [...state.mailboxIds].filter((id) => !state.quarantined.has(id))
        : [];
    return {
      entries:
        state?.entries.filter((entry) =>
          mailboxIds.includes(entry.mailboxId)
        ) ?? [],
      mailboxIds,
    };
  }, [state]);
};
