import type { QueryClient } from "@tanstack/react-query";
import { persistQueryByKey } from "~/lib/query-persister";
import {
  cloneComposeSessionState,
  createInitialComposeSessionState,
  type ComposeSessionState,
} from "./compose";

export const getComposeSessionQueryKey = (userId: string) => ["compose-session", userId] as const;

export const loadComposeSession = (
  queryClient: QueryClient,
  userId: string,
): ComposeSessionState => {
  const existing = queryClient.getQueryData<ComposeSessionState>(getComposeSessionQueryKey(userId));
  return existing ? cloneComposeSessionState(existing) : createInitialComposeSessionState();
};

export const persistComposeSession = async (
  queryClient: QueryClient,
  userId: string,
  session: ComposeSessionState,
) => {
  const queryKey = getComposeSessionQueryKey(userId);
  queryClient.setQueryData(queryKey, cloneComposeSessionState(session));
  await persistQueryByKey(queryClient, queryKey);
};
