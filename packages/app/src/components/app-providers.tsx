"use client";

import { MailtoProtocolHandler } from "@quieter/app/components/mailto-protocol-handler";
import { KeyboardShortcutsProvider } from "@quieter/app/features/hotkeys/components/keyboard-shortcuts-context";
import { authClient } from "@quieter/app/lib/auth";
import { bindMailCache } from "@quieter/app/lib/mail-cache-lifecycle";
import { disposeMailMutations } from "@quieter/app/lib/mail-mutations";
import { useMailUpdates } from "@quieter/app/lib/mail-updates";
import { shouldRetryOrpcError } from "@quieter/app/lib/orpc-errors";
import { setQueryPersistenceUser } from "@quieter/app/lib/query-persister";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import type { PropsWithChildren } from "react";

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
