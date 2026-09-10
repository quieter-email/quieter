export { getMessagesQueryKey } from "./keys";

export {
  messagesQueryOptions,
  refreshCachedMailboxQueries,
  refreshLoadedMessagesPages,
} from "./sync";

export {
  applyBulkChangesInMailbox,
  updateMessageInMailbox,
  updateThreadInMailbox,
  deleteDraftInMailbox,
  removeDraftMessageFromCaches,
} from "./actions";

export type { MailMetadataOperation } from "./actions";
