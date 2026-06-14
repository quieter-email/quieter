export {
  composeEmailInputSchema,
  composeEmailResultSchema,
  composeEmailToolDef,
  createGmailLabelListServerTool,
  createGmailMessageServerTool,
  createGmailSearchServerTool,
  createGmailThreadServerTool,
  createMailboxOverviewServerTool,
  createModifyMailServerTool,
  gmailLabelListResultSchema,
  gmailLabelListToolDef,
  gmailMessageResultSchema,
  gmailMessageToolDef,
  gmailSearchResultSchema,
  gmailSearchToolDef,
  gmailThreadResultSchema,
  gmailThreadToolDef,
  gmailToolsPrompt,
  mailboxOverviewResultSchema,
  mailboxOverviewToolDef,
  modifyMailResultSchema,
  modifyMailToolDef,
} from "./chat-agent";
export type {
  ComposeEmailInput,
  ComposeEmailResult,
  GmailLabelListResult,
  GmailMessageResult,
  GmailSearchResult,
  GmailThreadResult,
  GmailToolsContext,
  MailboxOverviewResult,
  ModifyMailResult,
} from "./chat-agent";
export { chatModels, chatModelSchema, defaultChatModel, type ChatModel } from "./chat-models";
export {
  classifyGmailMessage,
  GMAIL_AUTO_LABEL_MODEL,
  type GmailAutoLabelCandidate,
} from "./classify-gmail-message";
export {
  extractGmailUsefulDetail,
  GMAIL_USEFUL_DETAIL_MODEL,
  type GmailUsefulDetailCandidate,
} from "./extract-gmail-useful-detail";
export { createOpenRouterAdapter } from "./openrouter";
export { generateChatTitle } from "./generate-chat-title";
export { runChatStream } from "./run-chat-stream";
export { chatParamsFromRequest, toolDefinition } from "@tanstack/ai";
export type { ChatMiddleware, ModelMessage, ServerTool, UIMessage } from "@tanstack/ai";
