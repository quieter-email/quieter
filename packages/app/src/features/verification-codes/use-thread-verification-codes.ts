"use client";

import { useRecentConversations } from "@quieter/app/features/mailbox/components/recent-conversations-provider";
import type { MessageListProps } from "@quieter/app/features/message-list/components/message-list-types";
import type { ThreadListEntry } from "@quieter/app/lib/gmail/thread-list";
import { verificationCodesQueryOptions } from "@quieter/app/lib/mail/verification-codes-query";
import type { RouterOutputs } from "@quieter/orpc";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

export type VerificationCode =
  RouterOutputs["mail"]["listVerificationCodes"]["items"][number];

export const useVerificationCodeClock = (
  codes: readonly VerificationCode[]
) => {
  const [now, setNow] = useState(Date.now);
  const expiry = Math.min(
    ...codes
      .map((code) => new Date(code.expiresAt).getTime())
      .filter((time) => time > now)
  );
  useEffect((): (() => void) | undefined => {
    if (!Number.isFinite(expiry)) {
      return undefined;
    }
    const timer = window.setTimeout(
      () => {
        setNow(Date.now());
      },
      Math.min(Math.max(0, expiry - Date.now()), 2_147_483_647)
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [expiry]);
  // oxlint-disable-next-line react/purity -- Cached results must be checked against their expiry when they arrive.
  return Math.max(now, Date.now());
};

export const projectThreadVerificationCodes = (
  buckets: readonly { uiIdByOriginalId: ReadonlyMap<string, string> }[],
  results: readonly (readonly VerificationCode[])[],
  now: number
) => {
  const latestCodeByThreadId = new Map<
    string,
    RouterOutputs["mail"]["listVerificationCodes"]["items"][number]
  >();
  for (const [index, items] of results.entries()) {
    const bucket = buckets[index];
    if (bucket === undefined) {
      continue;
    }
    for (const code of items) {
      const uiThreadId = bucket.uiIdByOriginalId.get(code.threadId);
      if (
        new Date(code.expiresAt).getTime() > now &&
        uiThreadId &&
        !latestCodeByThreadId.has(uiThreadId)
      ) {
        latestCodeByThreadId.set(uiThreadId, code);
      }
    }
  }
  return latestCodeByThreadId;
};

export const useThreadVerificationCodes = (
  threadedMessages: Pick<ThreadListEntry, "threadId">[],
  list: Pick<
    MessageListProps,
    | "activeMailbox"
    | "mailboxId"
    | "mailboxProvider"
    | "mailboxContextsByThreadId"
  >
) => {
  const queryClient = useQueryClient();
  const { mailboxIds } = useRecentConversations();
  const codeThreadIdBuckets = useMemo(() => {
    if (list.activeMailbox === "drafts") {
      return [];
    }
    const sources = new Map<
      string,
      { threadIds: string[]; uiIdByOriginalId: Map<string, string> }
    >();
    for (const thread of threadedMessages) {
      const context = list.mailboxContextsByThreadId?.get(thread.threadId);
      if (
        (list.mailboxContextsByThreadId && !context) ||
        (context?.mailboxProvider ?? list.mailboxProvider) === "api"
      ) {
        continue;
      }
      const mailboxId = context?.mailboxId ?? list.mailboxId;
      if (!mailboxIds.includes(mailboxId)) {
        continue;
      }
      const originalThreadId = context?.originalThreadId ?? thread.threadId;
      const source = sources.get(mailboxId) ?? {
        threadIds: [],
        uiIdByOriginalId: new Map<string, string>(),
      };
      if (!source.uiIdByOriginalId.has(originalThreadId)) {
        source.threadIds.push(originalThreadId);
      }
      source.uiIdByOriginalId.set(originalThreadId, thread.threadId);
      sources.set(mailboxId, source);
    }
    const buckets: {
      mailboxId: string;
      threadIds: string[];
      uiIdByOriginalId: Map<string, string>;
    }[] = [];
    for (const [mailboxId, source] of sources) {
      for (let offset = 0; offset < source.threadIds.length; offset += 100) {
        buckets.push({
          mailboxId,
          threadIds: source.threadIds.slice(offset, offset + 100),
          uiIdByOriginalId: source.uiIdByOriginalId,
        });
      }
    }
    return buckets;
  }, [
    mailboxIds,
    threadedMessages,
    list.activeMailbox,
    list.mailboxContextsByThreadId,
    list.mailboxId,
    list.mailboxProvider,
  ]);
  const codeQueries = useQueries({
    queries: codeThreadIdBuckets.map(({ mailboxId, threadIds }) => ({
      ...verificationCodesQueryOptions(
        mailboxId,
        { mode: "threads", threadIds },
        true
      ),
      placeholderData: () => {
        const requestedThreadIds = new Set(threadIds);
        return {
          items: queryClient
            .getQueriesData<RouterOutputs["mail"]["listVerificationCodes"]>({
              queryKey: ["verification-codes", mailboxId, "threads"],
            })
            .toSorted(
              ([leftKey], [rightKey]) =>
                (queryClient.getQueryState(rightKey)?.dataUpdatedAt ?? 0) -
                (queryClient.getQueryState(leftKey)?.dataUpdatedAt ?? 0)
            )
            .flatMap(([, data]) => data?.items ?? [])
            .filter((item) => requestedThreadIds.has(item.threadId)),
        };
      },
    })),
  });
  const now = useVerificationCodeClock(
    codeQueries.flatMap((query) => query.data?.items ?? [])
  );
  return projectThreadVerificationCodes(
    codeThreadIdBuckets,
    codeQueries.map((query) => query.data?.items ?? []),
    now
  );
};
