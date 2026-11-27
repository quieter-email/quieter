"use client";

import { MailtoProtocolHandler } from "@quieter/app/components/mailto-protocol-handler";
import { KeyboardShortcutsProvider } from "@quieter/app/features/hotkeys/components/keyboard-shortcuts-context";
import { RecentConversationsProvider } from "@quieter/app/features/mailbox/components/recent-conversations-provider";
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
  restoreWarmWorkspaceQueries,
  setQueryPersistenceUser,
} from "@quieter/app/lib/query-persister";
import {
  getSessionRevocationVersion,
  isAuthorizedSessionRevoked,
  purgeAuthorizedSessionUser,
  seedAuthorizedSessionUser,
  subscribeSessionRevocation,
  syncAuthorizedSessionUser,
} from "@quieter/app/session-user";
import type { SessionUser } from "@quieter/app/session-user";
import { LinkButton } from "@quieter/ui/button";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PropsWithChildren } from "react";

import { AccountDateTimeProvider } from "../features/settings/components/account-date-time-provider";
import { AuthorizedSessionContext } from "./authorized-session-context";

const SessionQueryProvider = ({
  children,
  userId,
  sessionUnresolved,
  sessionId,
  skipWarmRestore,
}: PropsWithChildren<{
  userId: string | undefined;
  sessionId: string | undefined;
  sessionUnresolved: boolean;
  skipWarmRestore: boolean;
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
  const lifetime = useRef(0);

  useMailUpdates(queryClient, userId);

  useLayoutEffect(() => {
    lifetime.current += 1;
    const generation = lifetime.current;
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
      queueMicrotask(() => {
        if (lifetime.current === generation) {
          disposeMailMutations(queryClient);
          queryClient.clear();
        }
      });
    };
  }, [queryClient, sessionId, sessionUnresolved, userId]);

  useLayoutEffect(() => {
    if (userId && !sessionUnresolved && !skipWarmRestore) {
      void restoreWarmWorkspaceQueries(queryClient, userId, {
        search: window.location.search,
      });
    }
  }, [queryClient, sessionUnresolved, skipWarmRestore, userId]);

  return (
    <QueryClientProvider client={queryClient}>
      <RecentConversationsProvider
        client={queryClient}
        authenticated={!!userId && !!sessionId && !sessionUnresolved}
      >
        {children}
      </RecentConversationsProvider>
    </QueryClientProvider>
  );
};

export const AppProviders = ({
  children,
  initialUser,
}: PropsWithChildren<{ initialUser?: SessionUser }>) => {
  const session = authClient.useSession();
  useSyncExternalStore(
    subscribeSessionRevocation,
    getSessionRevocationVersion,
    getSessionRevocationVersion
  );
  const liveSession = isAuthorizedSessionRevoked(session.data?.session.id)
    ? undefined
    : session.data;
  const liveUser = liveSession?.user;
  const liveUserId = liveUser?.id;
  const liveSessionId = liveSession?.session.id;
  const authoritativeSignedOut =
    !session.isPending &&
    !session.isRefetching &&
    session.data === null &&
    (session.error === null || session.error.status === 401);
  const canReuseInitial =
    initialUser !== undefined &&
    !authoritativeSignedOut &&
    !isAuthorizedSessionRevoked(initialUser.sessionId);
  const userId = liveUserId ?? (canReuseInitial ? initialUser.id : undefined);
  const sessionId =
    liveSessionId ?? (canReuseInitial ? initialUser.sessionId : undefined);
  const sessionUnresolved =
    !userId &&
    (session.isPending ||
      (session.error !== null && session.error.status !== 401));

  useLayoutEffect(() => {
    if (authoritativeSignedOut) {
      purgeAuthorizedSessionUser(initialUser?.sessionId);
    } else if (liveUser && liveSessionId) {
      if (
        initialUser?.sessionId === liveSessionId &&
        initialUser.id === liveUser.id
      ) {
        seedAuthorizedSessionUser(initialUser);
      }
      syncAuthorizedSessionUser({
        email: liveUser.email,
        emailVerified: liveUser.emailVerified,
        id: liveUser.id,
        image: liveUser.image ?? null,
        name: liveUser.name,
        sessionId: liveSessionId,
      });
    } else if (canReuseInitial) {
      seedAuthorizedSessionUser(initialUser);
    }
  }, [
    authoritativeSignedOut,
    canReuseInitial,
    initialUser,
    liveSessionId,
    liveUser,
  ]);

  useLayoutEffect(() => {
    if (!sessionUnresolved) {
      void (async () => {
        try {
          await draftRecoveryJournal.setUser(userId, sessionId);
        } catch (error) {
          toastError(error, { boundary: "compose-recovery-identity-cleanup" });
        }
      })();
    }
  }, [sessionId, sessionUnresolved, userId]);

  return (
    <HotkeysProvider
      defaultOptions={{
        hotkey: {
          preventDefault: true,
          stopPropagation: true,
        },
      }}
    >
      <SessionQueryProvider
        key={`${userId ?? "anonymous"}:${sessionId ?? "anonymous"}`}
        sessionUnresolved={sessionUnresolved}
        sessionId={sessionId}
        skipWarmRestore={initialUser?.needsOnboarding === true && !liveUserId}
        userId={userId}
      >
        <AccountDateTimeProvider userId={userId}>
          <KeyboardShortcutsProvider>
            <MailtoProtocolHandler />
            <AuthorizedSessionContext value={{ sessionId, userId }}>
              {initialUser === undefined || initialUser.id === userId ? (
                children
              ) : (
                <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
                  <p role="alert">Sign in to continue.</p>
                  <LinkButton to="/auth">Sign in</LinkButton>
                </main>
              )}
            </AuthorizedSessionContext>
          </KeyboardShortcutsProvider>
        </AccountDateTimeProvider>
      </SessionQueryProvider>
    </HotkeysProvider>
  );
};
