import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { MailCategory } from "@quieter/mail/data-plane";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { mailboxLabelSchema } from "@quieter/mail/mailbox-organization";
import type { ThreadMessagesResult } from "@quieter/mail/messages";
import type { AppRouterClient } from "@quieter/orpc";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { normalizeMailQuery, queryKeys } from "./keys";

export const MAIL_PAGE_SIZE = 15;
const THREAD_STALE_TIME_MS = 1000 * 60 * 5;

const normalizeMailboxLabels = (value: unknown): MailboxLabel[] =>
  Array.isArray(value)
    ? value.flatMap((label) => {
        const parsed = mailboxLabelSchema.safeParse(label);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

export type MailMessagesQueryInput = {
  category: MailCategory;
  mailboxId: string;
  query?: string | null;
};

export type MailThreadQueryInput = {
  mailboxId: string;
  threadId: string;
};

export const createMailQueries = (client: AppRouterClient) => {
  const orpc = createTanstackQueryUtils(client);

  const listInput = ({ category, mailboxId, query }: MailMessagesQueryInput) =>
    ({
      category,
      mailboxId,
      maxResults: MAIL_PAGE_SIZE,
      query: normalizeMailQuery(query),
    }) as const;

  return {
    labels: (mailboxId: string) =>
      queryOptions<MailboxLabel[]>({
        queryFn: async ({ signal }) =>
          normalizeMailboxLabels(
            await client.mail.listLabels({ mailboxId }, { signal })
          ),
        queryKey: queryKeys.labels(mailboxId),
        staleTime: 1000 * 60 * 5,
      }),
    messages: (input: MailMessagesQueryInput) =>
      queryOptions<MailMessagesPageData>({
        queryFn: async ({ signal }) =>
          await client.mail.listThreads(listInput(input), { signal }),
        queryKey: queryKeys.messages(
          input.mailboxId,
          input.category,
          input.query
        ),
        staleTime: THREAD_STALE_TIME_MS,
      }),
    messagesInfinite: (input: MailMessagesQueryInput) =>
      infiniteQueryOptions<
        MailMessagesPageData,
        Error,
        InfiniteData<MailMessagesPageData>,
        readonly unknown[],
        string | undefined
      >({
        getNextPageParam: (lastPage) => lastPage.nextPageToken,
        initialPageParam: undefined,
        queryFn: async ({ pageParam, signal }) =>
          await client.mail.listThreads(
            { ...listInput(input), pageToken: pageParam },
            { signal }
          ),
        queryKey: queryKeys.messages(
          input.mailboxId,
          input.category,
          input.query
        ),
        staleTime: THREAD_STALE_TIME_MS,
      }),
    mutations: {
      applyChanges: orpc.mail.applyChanges.mutationOptions(),
      deleteDraft: orpc.mail.deleteDraft.mutationOptions(),
      markThreadAsRead: orpc.mail.markThreadAsRead.mutationOptions(),
      markThreadAsUnread: orpc.mail.markThreadAsUnread.mutationOptions(),
      moveThreadToTrash: orpc.mail.moveThreadToTrash.mutationOptions(),
      saveDraft: orpc.mail.saveDraft.mutationOptions(),
      sendDraft: orpc.mail.sendDraft.mutationOptions(),
      sendMessage: orpc.mail.sendMessage.mutationOptions(),
      untrashThread: orpc.mail.untrashThread.mutationOptions(),
      updateThreadLabels: orpc.mail.updateThreadLabels.mutationOptions(),
    },
    thread: ({ mailboxId, threadId }: MailThreadQueryInput) =>
      queryOptions<ThreadMessagesResult>({
        queryFn: async ({ signal }) =>
          await client.mail.getThread({ mailboxId, threadId }, { signal }),
        queryKey: queryKeys.thread(mailboxId, threadId),
        staleTime: THREAD_STALE_TIME_MS,
      }),
  };
};

export type MailQueries = ReturnType<typeof createMailQueries>;

export type MailMessagesPageData = Awaited<
  ReturnType<AppRouterClient["mail"]["listThreads"]>
>;

export type MailThreadData = Awaited<
  ReturnType<AppRouterClient["mail"]["getThread"]>
>;

export type MailMessageListItem = MailMessagesPageData["messages"][number];
export type MailThreadMessage = MailThreadData["messages"][number];

export const invalidateMailQuery = async (
  queryClient: QueryClient,
  mailboxId: string
) => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.messagesRoot(mailboxId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.threadRoot(mailboxId),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.labels(mailboxId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes() }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.gmailUnreadCounts(),
    }),
  ]);
};
