export const THREAD_QUERY_VERSION = 3;

export const getThreadQueryKey = (mailboxId: string, threadId: string) =>
  ["message-thread", THREAD_QUERY_VERSION, mailboxId, threadId] as const;

export const getMailboxThreadQueriesKey = (mailboxId: string) =>
  ["message-thread", THREAD_QUERY_VERSION, mailboxId] as const;
