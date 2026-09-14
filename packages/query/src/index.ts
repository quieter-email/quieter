export { createQueryApi, type QueryApi } from "./create-query-api";
export { normalizeMailQuery, queryKeys } from "./keys";
export {
  MAIL_PAGE_SIZE,
  invalidateMailQuery,
  type MailMessageListItem,
  type MailMessagesPageData,
  type MailMessagesQueryInput,
  type MailQueries,
  type MailThreadData,
  type MailThreadMessage,
  type MailThreadQueryInput,
} from "./mail";
export {
  APP_QUERY_GC_TIME_MS,
  APP_QUERY_STALE_TIME_MS,
  createAppQueryClient,
} from "./query-client";
export { shouldRetryOrpcError } from "./retry";
export type { AiQueries } from "./ai";
export type { ChatQueries } from "./chats";
export type { MailboxQueries } from "./mailboxes";
export type { OnboardingQueries } from "./onboarding";
export type { TemplateQueries } from "./templates";
