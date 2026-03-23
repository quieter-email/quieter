import type { QueryClient } from "@tanstack/react-query";
import { persistQueryByKey } from "~/lib/query-persister";
import {
  cloneComposeSessionState,
  createInitialComposeSessionState,
  type ComposeSessionState,
} from "./compose";

export const getComposeSessionQueryKey = (mailboxId: string) =>
  ["compose-session", mailboxId] as const;

export const loadComposeSession = (
  queryClient: QueryClient,
  mailboxId: string,
): ComposeSessionState => {
  const existing = queryClient.getQueryData<ComposeSessionState>(
    getComposeSessionQueryKey(mailboxId),
  );
  return existing ? cloneComposeSessionState(existing) : createInitialComposeSessionState();
};

export const persistComposeSession = async (
  queryClient: QueryClient,
  mailboxId: string,
  session: ComposeSessionState,
) => {
  const queryKey = getComposeSessionQueryKey(mailboxId);
  queryClient.setQueryData(queryKey, cloneComposeSessionState(session));
  await persistQueryByKey(queryClient, queryKey);
};
