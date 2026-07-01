import type { RouterOutputs } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";
import {
  getManagedDemoLabelCounts,
  getManagedDemoRules,
  getManagedDemoSavedViews,
} from "~/lib/managed-mail/demo-managed-mail";
import { rpc } from "~/lib/orpc";
import { queryPersister } from "~/lib/query-persister";
import { isManagedSandboxMailboxId } from "~/lib/sandbox-mailbox";

type ManagedSavedViews = RouterOutputs["mail"]["listManagedSavedViews"];
type ManagedRules = RouterOutputs["mail"]["listManagedRules"];
type ManagedLabelCounts = RouterOutputs["mail"]["listManagedLabelCounts"];

export const getManagedSavedViewsQueryKey = (mailboxId: string) =>
  ["managed-saved-views", mailboxId] as const;

export const managedSavedViewsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions<ManagedSavedViews>({
    enabled: enabled && !!mailboxId,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoSavedViews() as ManagedSavedViews;
      }

      return rpc.mail.listManagedSavedViews({ mailboxId }, { signal });
    },
    queryKey: getManagedSavedViewsQueryKey(mailboxId),
    persister: queryPersister.persisterFn,
  });

export const getManagedRulesQueryKey = (mailboxId: string) =>
  ["managed-mail-rules", mailboxId] as const;

export const managedRulesQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions<ManagedRules>({
    enabled: enabled && !!mailboxId,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoRules() as ManagedRules;
      }

      return rpc.mail.listManagedRules({ mailboxId }, { signal });
    },
    queryKey: getManagedRulesQueryKey(mailboxId),
  });

export const getManagedLabelCountsQueryKey = (mailboxId: string) =>
  ["managed-label-counts", mailboxId] as const;

export const managedLabelCountsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions<ManagedLabelCounts>({
    enabled: enabled && !!mailboxId,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoLabelCounts() as ManagedLabelCounts;
      }

      return rpc.mail.listManagedLabelCounts({ mailboxId }, { signal });
    },
    queryKey: getManagedLabelCountsQueryKey(mailboxId),
    persister: queryPersister.persisterFn,
  });
