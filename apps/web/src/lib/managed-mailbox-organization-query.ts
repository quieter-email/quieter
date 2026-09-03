import type { RouterOutputs } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";

import {
  getManagedDemoLabelCounts,
  getManagedDemoRules,
} from "#/lib/managed-mail/demo-managed-mail";
import { rpc } from "#/lib/orpc";
import { queryPersister } from "#/lib/query-persister";
import { isManagedSandboxMailboxId } from "#/lib/sandbox-mailbox";

type ManagedRules = RouterOutputs["mail"]["listManagedRules"];
type ManagedLabelCounts = RouterOutputs["mail"]["listManagedLabelCounts"];

export const getManagedRulesQueryKey = (mailboxId: string) =>
  ["managed-mail-rules", mailboxId] as const;

export const managedRulesQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions<ManagedRules>({
    enabled: enabled && !!mailboxId,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoRules();
      }

      return await rpc.mail.listManagedRules({ mailboxId }, { signal });
    },
    queryKey: getManagedRulesQueryKey(mailboxId),
  });

export const getManagedLabelCountsQueryKey = (mailboxId: string) =>
  ["managed-label-counts", mailboxId] as const;

export const managedLabelCountsQueryOptions = (
  mailboxId: string,
  enabled = true
) =>
  queryOptions<ManagedLabelCounts>({
    enabled: enabled && !!mailboxId,
    persister: queryPersister.persisterFn,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoLabelCounts();
      }

      return await rpc.mail.listManagedLabelCounts({ mailboxId }, { signal });
    },
    queryKey: getManagedLabelCountsQueryKey(mailboxId),
  });
