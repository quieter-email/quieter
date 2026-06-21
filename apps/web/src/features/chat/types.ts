import type { UIMessage } from "@tanstack/ai";
import type { ComposeFormValues } from "~/features/compose/domain/compose-form";
import type { MailboxCategory } from "~/lib/gmail/gmail";
export type {
  ComposeEmailInput,
  ComposeEmailResult,
  GmailLabelListResult as GmailLabelListToolResult,
  GmailMessageResult as GmailMessageToolResult,
  GmailSearchResult as GmailSearchToolResult,
  GmailThreadResult as GmailThreadToolResult,
  MailboxOverviewResult as MailboxOverviewToolResult,
  ModifyMailResult as ModifyMailToolResult,
} from "@quieter/ai";

export type ChatViewProps = {
  activeMailbox: MailboxCategory;
  chatId: string | null;
  draftChatKey: string;
  mailboxId: string;
  mailboxOrganizationId: string | null;
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
