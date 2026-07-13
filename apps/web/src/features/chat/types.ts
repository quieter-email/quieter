import type { UIMessage } from "@tanstack/ai";
import type { ComposeFormValues } from "~/features/compose/domain/compose-form";
import type { MailboxCategory } from "~/lib/gmail/gmail";
export type {
  ComposeEmailInput,
  ComposeEmailResult,
  GoogleCalendarCreateEventResult as GoogleCalendarEventToolResult,
  GmailAttachmentResult as GmailAttachmentToolResult,
  GmailLabelListResult as GmailLabelListToolResult,
  GmailMessageResult as GmailMessageToolResult,
  GmailMessagesResult as GmailMessagesToolResult,
  GmailSearchResult as GmailSearchToolResult,
  GmailThreadResult as GmailThreadToolResult,
  LinearIssueCreateResult as LinearIssueCreateToolResult,
  LinearIssueMetadataResult as LinearIssueMetadataToolResult,
  MailboxOverviewResult as MailboxOverviewToolResult,
  ModifyMailResult as ModifyMailToolResult,
} from "@quieter/ai/chat-agent";

export type ChatViewProps = {
  activeMailbox: MailboxCategory;
  chatId: string | null;
  draftChatKey: string;
  mailContext?: {
    messageId?: string;
    query?: string;
    threadId?: string;
  };
  mailboxId: string;
  mailboxOrganizationId: string;
  onChatIdChange: (chatId: string) => void;
  onOpenSidebar: () => void;
};

export type InlineComposeAction = "decline" | "save_draft" | "send";

export type ResolveComposeToolInput =
  | {
      action: "decline";
      assistantMessageId: string;
      toolCallId: string;
    }
  | {
      action: "save_draft" | "send";
      assistantMessageId: string;
      message: ComposeFormValues;
      toolCallId: string;
    };

export type ResolveComposeTool = (input: ResolveComposeToolInput) => Promise<void>;

export type ChatTurn = {
  assistant: UIMessage | null;
  id: string;
  user: UIMessage | null;
};
