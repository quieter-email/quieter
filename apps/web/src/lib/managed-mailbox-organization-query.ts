import { queryOptions } from "@tanstack/react-query";
import { rpc } from "~/lib/orpc";

export const getManagedSavedViewsQueryKey = (mailboxId: string) =>
  ["managed-saved-views", mailboxId] as const;

export const managedSavedViewsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions({
    enabled: enabled && !!mailboxId,
    queryFn: ({ signal }) => rpc.mail.listManagedSavedViews({ mailboxId }, { signal }),
    queryKey: getManagedSavedViewsQueryKey(mailboxId),
  });

export const getManagedRulesQueryKey = (mailboxId: string) =>
  ["managed-mail-rules", mailboxId] as const;

export const managedRulesQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions({
    enabled: enabled && !!mailboxId,
    queryFn: ({ signal }) => rpc.mail.listManagedRules({ mailboxId }, { signal }),
    queryKey: getManagedRulesQueryKey(mailboxId),
  });

export const getManagedLabelCountsQueryKey = (mailboxId: string) =>
  ["managed-label-counts", mailboxId] as const;

export const managedLabelCountsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions({
    enabled: enabled && !!mailboxId,
    queryFn: ({ signal }) => rpc.mail.listManagedLabelCounts({ mailboxId }, { signal }),
    queryKey: getManagedLabelCountsQueryKey(mailboxId),
  });
