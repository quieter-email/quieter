import { rpc } from "@quieter/app/lib/orpc";
import { queryPersister } from "@quieter/app/lib/query-persister";
import type { RouterOutputs } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

type MailboxManifest = RouterOutputs["mail"]["listMailboxes"];
const mailboxManifestListeners = new WeakMap<
  QueryClient,
  (manifest: MailboxManifest) => void
>();

export const subscribeToConfirmedMailboxes = (
  client: QueryClient,
  listener: (manifest: MailboxManifest) => void
) => {
  mailboxManifestListeners.set(client, listener);
  return () => {
    if (mailboxManifestListeners.get(client) === listener) {
      mailboxManifestListeners.delete(client);
    }
  };
};

export const getMailboxesQueryKey = () => ["mailboxes"] as const;
export const getMailboxSelectionQueryKey = ({
  isDemoMode,
  isEmptyPreviewPersona,
  isManagedDemoMode,
}: {
  isDemoMode: boolean;
  isEmptyPreviewPersona: boolean;
  isManagedDemoMode: boolean;
}) => {
  if (isEmptyPreviewPersona) {
    return [...getMailboxesQueryKey(), "sandbox", "empty"] as const;
  }
  if (isManagedDemoMode) {
    return [...getMailboxesQueryKey(), "sandbox", "managed"] as const;
  }
  if (isDemoMode) {
    return [...getMailboxesQueryKey(), "sandbox", "gmail"] as const;
  }
  return getMailboxesQueryKey();
};
export const getGmailUnreadCountsQueryKey = () =>
  ["gmail-unread-counts"] as const;

const MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS = 1000 * 60 * 30;
const MAILBOX_METADATA_STALE_MS = 1000 * 60;

export const mailboxesQueryOptions = (enabled = true) =>
  queryOptions<MailboxManifest>({
    enabled,
    networkMode: "offlineFirst",
    persister: queryPersister.persisterFn,
    queryFn: async ({ client, signal }) => {
      const manifest = await rpc.mail.listMailboxes(undefined, { signal });
      signal.throwIfAborted();
      mailboxManifestListeners.get(client)?.(manifest);
      return manifest;
    },
    queryKey: getMailboxesQueryKey(),
    refetchInterval: MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: true,
    staleTime: MAILBOX_METADATA_STALE_MS,
  });

export const gmailUnreadCountsQueryOptions = (enabled = true) =>
  queryOptions<RouterOutputs["mail"]["listGmailUnreadCounts"]>({
    enabled,
    networkMode: "offlineFirst",
    persister: queryPersister.persisterFn,
    queryFn: async ({ signal }) =>
      await rpc.mail.listGmailUnreadCounts(undefined, { signal }),
    queryKey: getGmailUnreadCountsQueryKey(),
    refetchInterval: MAILBOX_ACCOUNT_HEALTH_CHECK_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    staleTime: MAILBOX_METADATA_STALE_MS,
  });
