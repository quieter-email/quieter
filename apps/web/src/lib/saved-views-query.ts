import type { RouterOutputs } from "@quieter/orpc";
import { queryOptions } from "@tanstack/react-query";

import { getManagedDemoSavedViews } from "#/lib/managed-mail/demo-managed-mail";
import { rpc } from "#/lib/orpc";
import { queryPersister } from "#/lib/query-persister";
import {
  isGmailSandboxMailboxId,
  isManagedSandboxMailboxId,
} from "#/lib/sandbox-mailbox";

type SavedViews = RouterOutputs["mail"]["listSavedViews"];

export const getSavedViewsQueryKey = (mailboxId: string) =>
  ["saved-views", mailboxId] as const;

export const savedViewsQueryOptions = (mailboxId: string, enabled = true) =>
  queryOptions<SavedViews>({
    enabled: enabled && !!mailboxId,
    persister: queryPersister.persisterFn,
    queryFn: async ({ signal }) => {
      if (isManagedSandboxMailboxId(mailboxId)) {
        return getManagedDemoSavedViews().map((view) => ({
          ...view,
          createdAt: new Date(0),
          disabledReason: null,
          mailboxId,
          normalizedName: view.name.toLocaleLowerCase(),
          updatedAt: new Date(0),
        }));
      }

      if (isGmailSandboxMailboxId(mailboxId)) {
        return [];
      }

      return await rpc.mail.listSavedViews({ mailboxId }, { signal });
    },
    queryKey: getSavedViewsQueryKey(mailboxId),
  });
