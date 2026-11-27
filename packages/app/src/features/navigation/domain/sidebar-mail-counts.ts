import { useUnifiedInboxPreferences } from "@quieter/app/features/mailbox/domain/unified-inbox";
import type { UnifiedInboxMailbox } from "@quieter/app/features/mailbox/domain/unified-inbox";
import { GMAIL_QUERY_STALE_TIME_MS } from "@quieter/app/lib/mail";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import {
  getSidebarMailCountQueryKey,
  parsePageToken,
} from "@quieter/app/lib/mail/inbox-query/keys";
import { fetchMessagesPage } from "@quieter/app/lib/mail/inbox-query/sync";
import { orpc, rpc } from "@quieter/app/lib/orpc";
import { queryPersister } from "@quieter/app/lib/query-persister";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import { queryOptions, useQueries } from "@tanstack/react-query";

import { getDemoScheduledMessages } from "../../scheduled-send/domain/demo-scheduled-messages";

const COUNT_CAP = 100;

const mailboxCountOptions = ({
  entry,
  mailboxId,
  userId,
}: {
  entry: MailboxCategory;
  mailboxId: string;
  userId: string;
}) =>
  queryOptions<number | null>({
    persister: isSandboxMailboxId(mailboxId)
      ? undefined
      : queryPersister.persisterFn,
    queryFn: async ({ signal }) => {
      const rows = new Set<string>();
      const seenTokens = new Set<string>();
      const demo = isSandboxMailboxId(mailboxId);
      let pageToken: string | undefined;
      while (true) {
        const request = { mailboxId, maxResults: COUNT_CAP, pageToken };
        const page = demo
          ? await fetchMessagesPage({ ...request, mailbox: entry, signal })
          : undefined;
        const result = page
          ? {
              ids: page.messages.map((message) =>
                entry === "drafts"
                  ? (message.draftId ?? message.id)
                  : message.threadId
              ),
              nextPageToken: page.nextPageToken,
            }
          : await rpc.mail.listMailboxRowIds(
              { ...request, category: entry },
              { signal }
            );
        for (const id of result.ids) {
          rows.add(id);
        }
        if (rows.size >= COUNT_CAP) {
          return COUNT_CAP;
        }
        pageToken = parsePageToken(result.nextPageToken);
        if (pageToken === undefined) {
          return rows.size;
        }
        if (seenTokens.has(pageToken)) {
          return null;
        }
        seenTokens.add(pageToken);
      }
    },
    queryKey: [...getSidebarMailCountQueryKey(mailboxId, entry), userId],
    staleTime: GMAIL_QUERY_STALE_TIME_MS,
  });

export const useSidebarMailCounts = ({
  allInboxesActive,
  entries,
  mailboxId,
  mailboxes,
  userId,
}: {
  allInboxesActive: boolean;
  entries: readonly MailboxCategory[];
  mailboxId: string | null;
  mailboxes: readonly Pick<
    UnifiedInboxMailbox,
    "id" | "provider" | "connectionStatus"
  >[];
  userId: string;
}): ReadonlyMap<MailboxCategory, number> => {
  const { excludedIds } = useUnifiedInboxPreferences(userId);
  const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === mailboxId);
  const sources = mailboxes.filter(
    (mailbox) =>
      mailbox.connectionStatus === "connected" &&
      (userId !== "" || isSandboxMailboxId(mailbox.id)) &&
      (allInboxesActive
        ? mailbox.provider !== "api" && !excludedIds.includes(mailbox.id)
        : mailbox.id === mailboxId)
  );
  const mailEntries = [...new Set(entries)];
  const sourceQueries = mailEntries.flatMap((entry) =>
    sources.flatMap((mailbox) =>
      mailbox.provider === "api" && entry !== "sent"
        ? []
        : [{ entry, mailboxId: mailbox.id, userId }]
    )
  );
  const results = useQueries({
    queries: sourceQueries.map(mailboxCountOptions),
  });

  const scheduledSources = entries.includes("sent")
    ? sources.filter((mailbox) => mailbox.provider !== "api")
    : [];
  const scheduledCounts = useQueries({
    queries: scheduledSources.map(({ id }) => {
      const input = { mailboxId: id };
      return orpc.scheduledSends.count.queryOptions({
        enabled: !isSandboxMailboxId(id),
        input,
        queryKey: [
          ...orpc.scheduledSends.list.queryKey({ input }),
          "sidebar-count",
          userId,
        ],
        refetchInterval: GMAIL_QUERY_STALE_TIME_MS,
        staleTime: GMAIL_QUERY_STALE_TIME_MS,
      });
    }),
  });

  const counts = new Map<MailboxCategory, number>();
  if (allInboxesActive && selectedMailbox !== undefined) {
    for (const entry of mailEntries) {
      counts.set(entry, 0);
    }
  }
  const incomplete = new Set<MailboxCategory>();
  for (const [index, { entry }] of sourceQueries.entries()) {
    const result = results[index];
    const data = result?.isSuccess ? result.data : undefined;
    if (data === undefined || data === null) {
      incomplete.add(entry);
    }
    counts.set(
      entry,
      Math.min(COUNT_CAP, (counts.get(entry) ?? 0) + (data ?? 0))
    );
  }
  for (const [index, { id }] of scheduledSources.entries()) {
    const result = scheduledCounts[index];
    const count = isSandboxMailboxId(id)
      ? getDemoScheduledMessages().length
      : result?.data;
    if (count === undefined) {
      incomplete.add("sent");
    }
    counts.set(
      "sent",
      Math.min(COUNT_CAP, (counts.get("sent") ?? 0) + (count ?? 0))
    );
  }
  for (const entry of incomplete) {
    if (counts.get(entry) !== COUNT_CAP) {
      counts.delete(entry);
    }
  }
  return counts;
};
