import { authClient } from "@quieter/app/lib/auth";
import { isExpectedClientError } from "@quieter/app/lib/client-error-reporting";
import { subscribeMailboxAccessLoss } from "@quieter/app/lib/mail-cache-lifecycle";
import { rpc } from "@quieter/app/lib/orpc";
import { subscribeQuerySessionInvalidation } from "@quieter/app/lib/query-persister";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import {
  rankMatchingRecipients,
  RECIPIENT_SUGGESTION_BATCH_SIZE,
  RECIPIENT_SUGGESTION_LIMIT,
} from "@quieter/mail/correspondent-history";
import * as Sentry from "@sentry/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffectEvent, useLayoutEffect, useState } from "react";

import type {
  RecipientCompletion,
  RecipientSuggestion,
} from "../domain/recipient-completion";

type RecipientLookupScope = Readonly<{
  id: string;
  mailboxId: string;
  queryKey: readonly [string, string, string, string];
  revoke: () => void;
}>;

export type RecipientSuggestionScope = RecipientLookupScope &
  Readonly<{
    candidates: RecipientSuggestion[] | undefined;
    searchRemotely: boolean;
    warm: () => void;
  }>;

const loadRecipientSuggestions = async (
  scope: RecipientLookupScope | null,
  query: string | undefined,
  signal: AbortSignal
): Promise<RecipientSuggestion[]> => {
  if (!scope) {
    throw new DOMException("No mailbox to look up.", "AbortError");
  }
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
      const errorData = error instanceof Error && "data" in error && error.data;
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
        Sentry.captureException(error, {
          tags: { boundary: "compose-recipient-suggestions" },
        });
      }
    }
    throw error;
  }
};

/** Null whenever the composer may not look up recipients for its mailbox. */
export const useRecipientSuggestionScope = ({
  enabled,
  mailboxId,
  preload,
}: {
  enabled: boolean;
  mailboxId: string | null;
  preload: boolean;
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
  const [focusedId, setFocusedId] = useState<string | null>(null);
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

  const scope =
    enabled &&
    actorId &&
    sessionId &&
    ownerMailboxId &&
    revokedId !== id &&
    !isSandboxMailboxId(ownerMailboxId)
      ? { id, mailboxId: ownerMailboxId, queryKey, revoke }
      : null;
  const candidates = useQuery({
    enabled: preload && scope !== null && focusedId === id,
    gcTime: 0,
    persister: undefined,
    queryFn: async ({ signal }) =>
      await loadRecipientSuggestions(
        scope,
        undefined,
        AbortSignal.any([signal, AbortSignal.timeout(3000)])
      ),
    queryKey,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  return scope
    ? {
        ...scope,
        candidates: preload ? candidates.data : undefined,
        searchRemotely:
          !preload ||
          candidates.isError ||
          candidates.data?.length === RECIPIENT_SUGGESTION_BATCH_SIZE,
        warm: () => {
          setFocusedId(id);
        },
      }
    : null;
};

export const useRecipientSuggestions = (
  scope: RecipientSuggestionScope | null,
  completion: RecipientCompletion | null
) => {
  const query = completion?.query.toLowerCase() ?? "";
  const scopeKey = scope?.queryKey ?? ["recipient-suggestions"];
  const localMatches = completion
    ? rankMatchingRecipients(scope?.candidates ?? [], query).slice(
        0,
        RECIPIENT_SUGGESTION_LIMIT
      )
    : [];
  const { data, isPlaceholderData } = useQuery<RecipientSuggestion[]>({
    enabled: scope !== null && completion !== null && scope.searchRemotely,
    gcTime: 0,
    persister: undefined,
    placeholderData: (previous, previousQuery) => {
      const previousKey = previousQuery?.queryKey ?? [];
      const previousSearch = previousKey.at(-1);
      return previous &&
        typeof previousSearch === "string" &&
        query.startsWith(previousSearch) &&
        JSON.stringify(previousKey.slice(0, -1)) === scope?.id
        ? rankMatchingRecipients(previous, query)
        : undefined;
    },
    queryFn: async ({ signal }) => {
      // Debounce exact lookups when the capped batch cannot cover all matches.
      // oxlint-disable-next-line promise/avoid-new -- A newer query cancels this delay before sending a request.
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
      signal.throwIfAborted();
      return await loadRecipientSuggestions(scope, query, signal);
    },
    queryKey: [...scopeKey, query],
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  return scope &&
    completion &&
    data &&
    (scope.searchRemotely || scope.candidates === undefined) &&
    !(isPlaceholderData && localMatches.length > 0)
    ? data
    : localMatches;
};
