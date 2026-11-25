import { authClient } from "@quieter/app/lib/auth";
import { isExpectedClientError } from "@quieter/app/lib/client-error-reporting";
import { subscribeMailboxAccessLoss } from "@quieter/app/lib/mail-cache-lifecycle";
import { rpc } from "@quieter/app/lib/orpc";
import { subscribeQuerySessionInvalidation } from "@quieter/app/lib/query-persister";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import * as Sentry from "@sentry/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffectEvent, useLayoutEffect, useState } from "react";

import type {
  RecipientCompletion,
  RecipientSuggestion,
} from "../domain/recipient-completion";

export type RecipientSuggestionScope = Readonly<{
  id: string;
  mailboxId: string;
  queryKey: readonly [string, string, string, string];
  revoke: () => void;
}>;

/** Null whenever the composer may not look up recipients for its mailbox. */
export const useRecipientSuggestionScope = ({
  enabled,
  mailboxId,
}: {
  enabled: boolean;
  mailboxId: string | null;
}): RecipientSuggestionScope | null => {
  const queryClient = useQueryClient();
  const session = authClient.useSession().data;
  const actorId = session?.user.id ?? "";
  const sessionId = session?.session.id ?? "";
  const ownerMailboxId = mailboxId ?? "";
  const queryKey = [
    "recipient-suggestions",
    actorId,
    sessionId,
    ownerMailboxId,
  ] as const;
  const id = JSON.stringify(queryKey);
  const [revokedId, setRevokedId] = useState<string | null>(null);
  const removeSuggestions = () => {
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  };
  const revoke = () => {
    setRevokedId(id);
    removeSuggestions();
  };
  const handleRevoke = useEffectEvent(revoke);
  useLayoutEffect(() => {
    const unsubscribeSession = subscribeQuerySessionInvalidation(
      queryClient,
      () => {
        handleRevoke();
      }
    );
    const unsubscribeAccess = subscribeMailboxAccessLoss(
      queryClient,
      (loss) => {
        if (loss.mailboxId === ownerMailboxId && loss.threadId === undefined) {
          handleRevoke();
        }
      }
    );
    return () => {
      unsubscribeSession();
      unsubscribeAccess();
    };
  }, [ownerMailboxId, queryClient]);

  return enabled &&
    actorId &&
    sessionId &&
    ownerMailboxId &&
    revokedId !== id &&
    !isSandboxMailboxId(ownerMailboxId)
    ? { id, mailboxId: ownerMailboxId, queryKey, revoke }
    : null;
};

export const useRecipientSuggestions = (
  scope: RecipientSuggestionScope | null,
  completion: RecipientCompletion | null
) => {
  const query = completion?.query ?? "";
  const scopeKey = scope?.queryKey ?? ["recipient-suggestions"];
  const { data } = useQuery<
    RecipientSuggestion[],
    Error,
    RecipientSuggestion[],
    readonly string[]
  >({
    enabled: scope !== null && completion !== null,
    gcTime: 0,
    persister: undefined,
    // Narrow the last matching results while the longer query loads, so the list
    // does not close and reopen on each keystroke.
    placeholderData: (previous, previousQuery) => {
      const previousKey = previousQuery?.queryKey ?? [];
      const previousSearch = previousKey.at(-1);
      const narrows =
        previousSearch !== undefined &&
        query.startsWith(previousSearch) &&
        JSON.stringify(previousKey.slice(0, -1)) === scope?.id;
      const terms = query.toLowerCase().split(" ");
      return previous?.filter(({ email, name }) => {
        const text = `${name ?? ""} ${email}`.toLowerCase();
        return narrows && terms.every((term) => text.includes(term));
      });
    },
    queryFn: async ({ signal }) => {
      if (!scope) {
        throw new DOMException("No mailbox to look up.", "AbortError");
      }
      // oxlint-disable-next-line promise/avoid-new -- Debounce inside the query so a newer query cancels this one.
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
      signal.throwIfAborted();
      try {
        const suggestions = await rpc.mail.listRecipientSuggestions(
          { mailboxId: scope.mailboxId, query },
          { signal }
        );
        signal.throwIfAborted();
        return suggestions;
      } catch (error) {
        if (!signal.aborted) {
          const status =
            error instanceof Error && "status" in error
              ? Number(error.status)
              : Number.NaN;
          const errorData =
            error instanceof Error && "data" in error && error.data;
          if (
            status === 401 ||
            status === 403 ||
            (typeof errorData === "object" &&
              errorData !== null &&
              "resource" in errorData &&
              errorData.resource === "mailbox")
          ) {
            scope.revoke();
          } else if (
            !(status >= 400 && status < 500) &&
            navigator.onLine &&
            !isExpectedClientError(error)
          ) {
            // Suggestions are optional while typing, so a failure is reported
            // without interrupting the writer.
            Sentry.captureException(error, {
              tags: { boundary: "compose-recipient-suggestions" },
            });
          }
        }
        throw error;
      }
    },
    queryKey: [...scopeKey, query],
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  return scope && completion ? (data ?? []) : [];
};
