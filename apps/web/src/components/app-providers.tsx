"use client";

import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import type { PropsWithChildren } from "react";

import { MailtoProtocolHandler } from "#/components/mailto-protocol-handler";
import { KeyboardShortcutsProvider } from "#/features/hotkeys/components/keyboard-shortcuts-context";
import { authClient } from "#/lib/auth";
import { bindMailCache } from "#/lib/mail-cache-lifecycle";
import { disposeMailMutations } from "#/lib/mail-mutations";
import { useMailUpdates } from "#/lib/mail-updates";
import { shouldRetryOrpcError } from "#/lib/orpc-errors";
import { setQueryPersistenceUser } from "#/lib/query-persister";

const SessionQueryProvider = ({
  children,
  userId,
}: PropsWithChildren<{ userId: string | undefined }>) => {
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
    setQueryPersistenceUser(userId, queryClient);
    const unbind = bindMailCache(queryClient);
    return () => {
      unbind();
      disposeMailMutations(queryClient);
      queryClient.clear();
    };
  }, [queryClient, userId]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

export const AppProviders = ({ children }: PropsWithChildren) => {
  const session = authClient.useSession();
  const userId = session.data?.user.id;

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
      <SessionQueryProvider key={userId ?? "anonymous"} userId={userId}>
        <KeyboardShortcutsProvider>
          <MailtoProtocolHandler />
          {children}
        </KeyboardShortcutsProvider>
      </SessionQueryProvider>
    </HotkeysProvider>
  );
};
