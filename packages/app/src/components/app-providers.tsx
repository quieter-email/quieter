"use client";

import { MailtoProtocolHandler } from "@quieter/app/components/mailto-protocol-handler";
import { KeyboardShortcutsProvider } from "@quieter/app/features/hotkeys/components/keyboard-shortcuts-context";
import { authClient } from "@quieter/app/lib/auth";
import { bindCalendarCache } from "@quieter/app/lib/calendar-cache-lifecycle";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { toastError } from "@quieter/app/lib/error-toast";
import { bindMailCache } from "@quieter/app/lib/mail-cache-lifecycle";
import { disposeMailMutations } from "@quieter/app/lib/mail-mutations";
import { useMailUpdates } from "@quieter/app/lib/mail-updates";
import { shouldRetryOrpcError } from "@quieter/app/lib/orpc-errors";
import {
  clearQueryPersistence,
  setQueryPersistenceUser,
} from "@quieter/app/lib/query-persister";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import type { PropsWithChildren } from "react";

import { AccountDateTimeProvider } from "../features/settings/components/account-date-time-provider";

const SessionQueryProvider = ({
  children,
  userId,
  sessionUnresolved,
  sessionId,
}: PropsWithChildren<{
  userId: string | undefined;
  sessionId: string | undefined;
  sessionUnresolved: boolean;
}>) => {
  // The client is owned for this provider lifetime and is never replaced by a setter.
  // oxlint-disable-next-line react/hook-use-state
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: {
            gcTime: 1000 * 60 * 30,
            retry: shouldRetryOrpcError,
          },
        },
      })
  );

  useMailUpdates(queryClient, userId);

  useLayoutEffect(() => {
    if (!sessionUnresolved) {
      if (userId) {
        setQueryPersistenceUser(userId, queryClient, sessionId);
      } else {
        void (async () => {
          try {
            await clearQueryPersistence();
          } catch (error) {
            toastError(error, { boundary: "session-cache-cleanup" });
          }
        })();
      }
    }
    const unbind = bindMailCache(queryClient);
    const unbindCalendar = bindCalendarCache(queryClient, userId);
    return () => {
      unbind();
      unbindCalendar();
      disposeMailMutations(queryClient);
      queryClient.clear();
    };
  }, [queryClient, sessionId, sessionUnresolved, userId]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

export const AppProviders = ({ children }: PropsWithChildren) => {
  const session = authClient.useSession();
  const userId = session.data?.user.id;

  useLayoutEffect(() => {
    if (!session.isPending) {
      try {
        draftRecoveryJournal.setUser(userId);
      } catch (error) {
        toastError(error, { boundary: "compose-recovery-identity-cleanup" });
      }
    }
  }, [session.isPending, userId]);

  return (
    <HotkeysProvider
      defaultOptions={{
        hotkey: {
          preventDefault: true,
          stopPropagation: true,
        },
        hotkeySequence: {
          preventDefault: true,
          stopPropagation: true,
        },
      }}
    >
      <SessionQueryProvider
        key={session.data?.session.id ?? "anonymous"}
        sessionUnresolved={
          !userId &&
          (session.isPending ||
            (session.error !== null && session.error.status !== 401))
        }
        sessionId={session.data?.session.id}
        userId={userId}
      >
        <AccountDateTimeProvider userId={userId}>
          <KeyboardShortcutsProvider>
            <MailtoProtocolHandler />
            {children}
          </KeyboardShortcutsProvider>
        </AccountDateTimeProvider>
      </SessionQueryProvider>
    </HotkeysProvider>
  );
};
