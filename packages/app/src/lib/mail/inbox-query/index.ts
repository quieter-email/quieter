export {
  getLiveSyncQueryKey,
  getMessagesQueryKey,
} from "@quieter/app/lib/mail/inbox-query/keys";

export {
  liveSyncQueryOptions,
  messagesQueryOptions,
  refreshCachedMailboxQueries,
  refreshLoadedMessagesPages,
  syncMessages,
} from "@quieter/app/lib/mail/inbox-query/sync";

export {
  applyBulkChangesInMailbox,
  updateMessageInMailbox,
  updateThreadInMailbox,
  deleteDraftInMailbox,
  removeDraftMessageFromCaches,
} from "@quieter/app/lib/mail/inbox-query/actions";

export type { MailMetadataOperation } from "@quieter/app/lib/mail/inbox-query/actions";
