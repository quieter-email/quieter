"use client";

import { composeEmailInputSchema } from "@quieter/ai/chat-agent";
import type { MessagePart } from "@tanstack/ai";
import { useNavigate } from "@tanstack/react-router";
import { m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { getAppPresenceMotion } from "#/features/motion/app-motion";

import { parseToolArguments, parseToolResult } from "../../domain/chat-tools";
import type {
  GmailSearchToolResult,
  ModifyMailToolResult,
  ResolveComposeTool,
} from "../../types";
import { InlineComposeTool } from "./inline-compose-tool";
import { AttachmentTool } from "./tools/attachment-tool";
import { LabelsTool } from "./tools/labels-tool";
import { MessageTool } from "./tools/message-tool";
import { MessagesTool } from "./tools/messages-tool";
import { ModifyTool } from "./tools/modify-tool";
import { OverviewTool } from "./tools/overview-tool";
import { SearchTool } from "./tools/search-tool";
import { ThreadTool } from "./tools/thread-tool";
import type { ToolIcon } from "./tools/tool-icons";
import { getToolIcon } from "./tools/tool-icons";
import { ToolStep } from "./tools/tool-step";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;

const isModifyMailAction = (
  value: unknown
): value is ModifyMailToolResult["action"] =>
  value === "archive" ||
  value === "mark_read" ||
  value === "mark_unread" ||
  value === "star" ||
  value === "trash" ||
  value === "unstar" ||
  value === "untrash";

const isModifyMailTarget = (
  value: unknown
): value is ModifyMailToolResult["target"] =>
  value === "message" || value === "thread";

type ToolPartProps = {
  actionsDisabled?: boolean;
  /** This is the step the model is on right now. */
  active?: boolean;
  animateEntrance?: boolean;
  assistantMessageId?: string;
  call?: ToolCall;
  isStreaming?: boolean;
  nested?: boolean;
  onResolveCompose?: ResolveComposeTool;
  result?: ToolResult;
};

const getResultError = (
  parsed: ReturnType<typeof parseToolResult>,
  result?: ToolResult
) => {
  if (result?.state === "error") {
    return result.error ?? "Something went wrong.";
  }

  if ("data" in parsed && parsed.data.status === "error") {
    return parsed.data.error;
  }

  return null;
};

const isComposeReady = (state: ToolCall["state"]) =>
  state === "input-complete" ||
  state === "approval-requested" ||
  state === "approval-responded";

const ComposeToolPart = ({
  actionsDisabled,
  animateEntrance,
  assistantMessageId,
  call,
  composeMotion,
  onResolveCompose,
  parsed,
  result,
}: {
  actionsDisabled?: boolean;
  animateEntrance: boolean;
  assistantMessageId?: string;
  call: ToolCall;
  composeMotion: ReturnType<typeof getAppPresenceMotion>;
  onResolveCompose?: ResolveComposeTool;
  parsed: ReturnType<typeof parseToolResult>;
  result?: ToolResult;
}) => {
  const initial = composeEmailInputSchema.safeParse(
    ("input" in call ? call.input : undefined) ??
      parseToolArguments(call.arguments)
  );
  if (
    !isComposeReady(call.state) ||
    !initial.success ||
    assistantMessageId === undefined ||
    assistantMessageId === "" ||
    onResolveCompose === undefined
  ) {
    return null;
  }

  const composeResult =
    parsed.kind === "compose-email" ? parsed.data : undefined;
  return (
    <m.div
      {...composeMotion}
      className="py-1"
      initial={animateEntrance ? composeMotion.initial : false}
    >
      <InlineComposeTool
        disabled={actionsDisabled}
        initial={initial.data}
        onResolve={async (action, message) => {
          if (action === "decline") {
            await onResolveCompose({
              action,
              assistantMessageId,
              toolCallId: call.id,
            });
            return;
          }

          if (!message) {
            throw new Error("The email content is missing.");
          }

          await onResolveCompose({
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
};

type ToolPartRendererProps = {
  active: boolean;
  args: Record<string, unknown>;
  icon: ToolIcon;
  error: string | null;
  name: string;
  nested: boolean;
  onOpenMessage: (
    category: GmailSearchToolResult["category"],
    messageId: string
  ) => void;
  parsed: ReturnType<typeof parseToolResult>;
  pending: boolean;
};

const getStringArgument = (args: Record<string, unknown>, key: string) =>
  typeof args[key] === "string" ? args[key] : "";

const getArrayLengthArgument = (args: Record<string, unknown>, key: string) =>
  Array.isArray(args[key]) ? args[key].length : undefined;

const getCalendarDetail = (
  args: Record<string, unknown>,
  parsed: ReturnType<typeof parseToolResult>
) => {
  if (
    parsed.kind === "google-calendar-event" &&
    parsed.data.status === "success"
  ) {
    return parsed.data.summary;
  }
  return getStringArgument(args, "summary");
};

const toolPartRenderers: Record<
  string,
  (props: ToolPartRendererProps) => ReactNode
> = {
  create_google_calendar_event: ({
    active,
    icon,
    args,
    error,
    nested,
    parsed,
    pending,
  }) => (
    <ToolStep
      active={active}
      icon={icon}
      nested={nested}
      detail={getCalendarDetail(args, parsed)}
      error={error}
      label={pending ? "Adding calendar event" : "Added calendar event"}
      pending={pending}
    />
  ),
  get_mailbox_overview: ({ active, icon, error, nested, parsed, pending }) => (
    <OverviewTool
      active={active}
      icon={icon}
      nested={nested}
      data={parsed.kind === "mailbox-overview" ? parsed.data : undefined}
      error={error}
      pending={pending}
    />
  ),
  list_gmail_labels: ({ active, icon, error, nested, parsed, pending }) => (
    <LabelsTool
      active={active}
      icon={icon}
      nested={nested}
      data={parsed.kind === "gmail-labels" ? parsed.data : undefined}
      error={error}
      pending={pending}
    />
  ),
  modify_mail: ({ active, icon, args, error, nested, parsed, pending }) => (
    <ModifyTool
      active={active}
      icon={icon}
      action={isModifyMailAction(args.action) ? args.action : undefined}
      nested={nested}
      data={parsed.kind === "modify-mail" ? parsed.data : undefined}
      error={error}
      pending={pending}
      target={isModifyMailTarget(args.target) ? args.target : undefined}
    />
  ),
  read_gmail_attachment: ({ active, icon, error, nested, parsed, pending }) => (
    <AttachmentTool
      active={active}
      icon={icon}
      data={parsed.kind === "gmail-attachment" ? parsed.data : undefined}
      error={error}
      nested={nested}
      pending={pending}
    />
  ),
  read_gmail_message: ({
    active,
    icon,
    error,
    nested,
    onOpenMessage,
    parsed,
    pending,
  }) => (
    <MessageTool
      active={active}
      icon={icon}
      nested={nested}
      data={parsed.kind === "gmail-message" ? parsed.data : undefined}
      error={error}
      onOpenMessage={onOpenMessage}
      pending={pending}
    />
  ),
  read_gmail_messages: ({
    active,
    icon,
    args,
    error,
    nested,
    onOpenMessage,
    parsed,
    pending,
  }) => (
    <MessagesTool
      active={active}
      icon={icon}
      nested={nested}
      data={parsed.kind === "gmail-messages" ? parsed.data : undefined}
      error={error}
      onOpenMessage={onOpenMessage}
      pending={pending}
      requestedCount={getArrayLengthArgument(args, "messageIds")}
    />
  ),
  read_gmail_thread: ({
    active,
    icon,
    args,
    error,
    nested,
    onOpenMessage,
    parsed,
    pending,
  }) => (
    <ThreadTool
      active={active}
      icon={icon}
      nested={nested}
      data={parsed.kind === "gmail-thread" ? parsed.data : undefined}
      error={error}
      onOpenMessage={onOpenMessage}
      pending={pending}
      threadId={getStringArgument(args, "threadId")}
    />
  ),
  search_gmail: ({
    active,
    icon,
    args,
    error,
    nested,
    onOpenMessage,
    parsed,
    pending,
  }) => (
    <SearchTool
      active={active}
      icon={icon}
      nested={nested}
      data={parsed.kind === "gmail-search" ? parsed.data : undefined}
      error={error}
      onOpenMessage={onOpenMessage}
      pending={pending}
      query={getStringArgument(args, "query")}
    />
  ),
};

const ToolPartRenderer = (props: ToolPartRendererProps): ReactNode => {
  const { active, error, icon, name, nested, parsed, pending } = props;
  const renderer = toolPartRenderers[name];
  return renderer === undefined ? (
    <ToolStep
      active={active}
      icon={icon}
      nested={nested}
      detail={name}
      error={
        error ?? (parsed.kind === "unknown" ? "Unsupported tool result." : null)
      }
      label={pending ? "Running tool" : "Ran tool"}
      pending={pending}
    />
  ) : (
    renderer(props)
  );
};

export const ToolPart = ({
  actionsDisabled,
  active = false,
  animateEntrance = false,
  assistantMessageId,
  call,
  isStreaming = false,
  nested = false,
  onResolveCompose,
  result,
}: ToolPartProps) => {
  const shouldReduceMotion = useReducedMotion();
  const composeMotion = getAppPresenceMotion({
    reducedMotion: shouldReduceMotion,
  });
  const navigate = useNavigate({ from: "/" });
  const name = call?.name ?? "unknown";
  const parsed = parseToolResult(name, result?.content ?? "");
  const pending = !result && isStreaming;
  const error =
    getResultError(parsed, result) ??
    (!result && !isStreaming && name !== "compose_email"
      ? "This step did not finish."
      : null);
  const args = call ? parseToolArguments(call.arguments) : {};

  const openMessage = (
    category: GmailSearchToolResult["category"],
    messageId: string
  ) => {
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
    const compose = (
      <ComposeToolPart
        actionsDisabled={actionsDisabled}
        animateEntrance={animateEntrance}
        assistantMessageId={assistantMessageId}
        call={call}
        composeMotion={composeMotion}
        onResolveCompose={onResolveCompose}
        parsed={parsed}
        result={result}
      />
    );
    if (compose !== null) {
      return compose;
    }
  }

  return (
    <ToolPartRenderer
      active={active}
      args={args}
      icon={getToolIcon(
        name,
        typeof args.action === "string" ? args.action : undefined
      )}
      error={error}
      name={name}
      nested={nested}
      onOpenMessage={openMessage}
      parsed={parsed}
      pending={pending}
    />
  );
};
