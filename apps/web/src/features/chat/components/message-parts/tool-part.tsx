"use client";

import type { MessagePart } from "@tanstack/ai";
import { composeEmailInputSchema } from "@quieter/ai/chat-agent";
import { useNavigate } from "@tanstack/react-router";
import { m } from "motion/react";
import type { GmailSearchToolResult, ModifyMailToolResult, ResolveComposeTool } from "../../types";
import { parseToolArguments, parseToolResult } from "../../domain/chat-tools";
import { InlineComposeTool } from "./inline-compose-tool";
import { AttachmentTool } from "./tools/attachment-tool";
import { LabelsTool } from "./tools/labels-tool";
import { MessageTool } from "./tools/message-tool";
import { MessagesTool } from "./tools/messages-tool";
import { ModifyTool } from "./tools/modify-tool";
import { OverviewTool } from "./tools/overview-tool";
import { SearchTool } from "./tools/search-tool";
import { ThreadTool } from "./tools/thread-tool";
import { ToolStep } from "./tools/tool-step";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;

type ToolPartProps = {
  actionsDisabled?: boolean;
  assistantMessageId?: string;
  call?: ToolCall;
  nested?: boolean;
  onResolveCompose?: ResolveComposeTool;
  result?: ToolResult;
};

const getResultError = (parsed: ReturnType<typeof parseToolResult>, result?: ToolResult) => {
  if (result?.state === "error") {
    return result.error || "Something went wrong.";
  }

  if ("data" in parsed && parsed.data.status === "error") {
    return parsed.data.error;
  }

  return null;
};

export const ToolPart = ({
  actionsDisabled,
  assistantMessageId,
  call,
  nested = false,
  onResolveCompose,
  result,
}: ToolPartProps) => {
  const navigate = useNavigate({ from: "/" });
  const name = call?.name ?? "unknown";
  const parsed = parseToolResult(name, result?.content ?? "");
  const pending = !result;
  const error = getResultError(parsed, result);
  const args = call ? parseToolArguments(call.arguments) : {};

  const openMessage = (category: GmailSearchToolResult["category"], messageId: string) => {
    void navigate({
      search: (previous) => ({
        mailbox: category,
        mailboxId: previous.mailboxId,
        messageId,
        query: "",
        view: "inbox",
      }),
      to: ".",
    });
  };

  if (name === "compose_email" && call) {
    const isReady =
      call.state === "input-complete" ||
      call.state === "approval-requested" ||
      call.state === "approval-responded";
    const initial = composeEmailInputSchema.safeParse(
      ("input" in call ? call.input : undefined) ?? parseToolArguments(call.arguments),
    );
    const composeResult = parsed.kind === "compose-email" ? parsed.data : undefined;

    if (isReady && initial.success && assistantMessageId && onResolveCompose) {
      return (
        <m.div
          animate={{ opacity: 1 }}
          className="py-1"
          initial={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <InlineComposeTool
            disabled={actionsDisabled}
            initial={initial.data}
            onResolve={(action, message) => {
              if (action === "decline") {
                return onResolveCompose({
                  action,
                  assistantMessageId,
                  toolCallId: call.id,
                });
              }

              if (!message) {
                return Promise.reject(new Error("The email content is missing."));
              }

              return onResolveCompose({
                action,
                assistantMessageId,
                message,
                toolCallId: call.id,
              });
            }}
            processing={call.state === "approval-responded" && !result}
            result={composeResult}
          />
        </m.div>
      );
    }
  }

  if (name === "search_gmail") {
    return (
      <SearchTool
        nested={nested}
        data={parsed.kind === "gmail-search" ? parsed.data : undefined}
        error={error}
        onOpenMessage={openMessage}
        pending={pending}
        query={typeof args.query === "string" ? args.query : undefined}
      />
    );
  }

  if (name === "read_gmail_thread") {
    return (
      <ThreadTool
        nested={nested}
        data={parsed.kind === "gmail-thread" ? parsed.data : undefined}
        error={error}
        onOpenMessage={openMessage}
        pending={pending}
        threadId={typeof args.threadId === "string" ? args.threadId : undefined}
      />
    );
  }

  if (name === "read_gmail_message") {
    return (
      <MessageTool
        nested={nested}
        data={parsed.kind === "gmail-message" ? parsed.data : undefined}
        error={error}
        onOpenMessage={openMessage}
        pending={pending}
      />
    );
  }

  if (name === "read_gmail_messages") {
    return (
      <MessagesTool
        nested={nested}
        data={parsed.kind === "gmail-messages" ? parsed.data : undefined}
        error={error}
        onOpenMessage={openMessage}
        pending={pending}
        requestedCount={Array.isArray(args.messageIds) ? args.messageIds.length : undefined}
      />
    );
  }

  if (name === "read_gmail_attachment") {
    return (
      <AttachmentTool
        data={parsed.kind === "gmail-attachment" ? parsed.data : undefined}
        error={error}
        nested={nested}
        pending={pending}
      />
    );
  }

  if (name === "get_mailbox_overview") {
    return (
      <OverviewTool
        nested={nested}
        data={parsed.kind === "mailbox-overview" ? parsed.data : undefined}
        error={error}
        pending={pending}
      />
    );
  }

  if (name === "list_gmail_labels") {
    return (
      <LabelsTool
        nested={nested}
        data={parsed.kind === "gmail-labels" ? parsed.data : undefined}
        error={error}
        pending={pending}
      />
    );
  }

  if (name === "modify_mail") {
    return (
      <ModifyTool
        action={
          typeof args.action === "string"
            ? (args.action as ModifyMailToolResult["action"])
            : undefined
        }
        nested={nested}
        data={parsed.kind === "modify-mail" ? parsed.data : undefined}
        error={error}
        pending={pending}
        target={
          typeof args.target === "string"
            ? (args.target as ModifyMailToolResult["target"])
            : undefined
        }
      />
    );
  }

  if (name === "create_google_calendar_event") {
    const data = parsed.kind === "google-calendar-event" ? parsed.data : undefined;
    const summary =
      data?.status === "success"
        ? data.summary
        : typeof args.summary === "string"
          ? args.summary
          : undefined;

    return (
      <ToolStep
        nested={nested}
        detail={summary}
        error={error}
        label={pending ? "Adding calendar event" : "Added calendar event"}
        pending={pending}
      />
    );
  }

  if (name === "list_linear_issue_metadata") {
    const data = parsed.kind === "linear-issue-metadata" ? parsed.data : undefined;
    const detail =
      data?.status === "success"
        ? `${data.teams.length} team${data.teams.length === 1 ? "" : "s"}`
        : undefined;

    return (
      <ToolStep
        nested={nested}
        detail={detail}
        error={error}
        label={pending ? "Reading Linear workspace" : "Read Linear workspace"}
        pending={pending}
      />
    );
  }

  if (name === "create_linear_issue") {
    const data = parsed.kind === "linear-issue-create" ? parsed.data : undefined;
    const detail =
      data?.status === "success"
        ? data.identifier
        : typeof args.title === "string"
          ? args.title
          : undefined;

    return (
      <ToolStep
        nested={nested}
        detail={detail}
        error={error}
        label={pending ? "Creating Linear issue" : "Created Linear issue"}
        pending={pending}
      />
    );
  }

  return (
    <ToolStep
      nested={nested}
      detail={call ? name : undefined}
      error={error ?? (parsed.kind === "unknown" ? "Unsupported tool result." : null)}
      label={pending ? "Running tool" : "Ran tool"}
      pending={pending}
    />
  );
};
