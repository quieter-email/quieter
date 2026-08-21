"use client";

import {
  Alert02Icon,
  Archive01Icon,
  ArrowRight01Icon,
  Attachment01Icon,
  Brain01Icon,
  Calendar01Icon,
  CheckmarkCircle02Icon,
  Comment01Icon,
  Loading03Icon,
  Mail01Icon,
  Mailbox01Icon,
  PencilEdit01Icon,
  Search01Icon,
  Tag01Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { composeEmailInputSchema } from "@quieter/ai/chat-agent";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@quieter/ui/collapsible";
import type { MessagePart } from "@tanstack/ai";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  getString,
  humanizeToolName,
  isRecord,
  parseToolArguments,
  parseToolResult,
} from "../domain/chat-tools";
import type { ChatToolApproval } from "../domain/chat-tools";
import { ComposeToolApproval } from "./compose-tool-approval";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;
type ToolIcon = typeof Wrench01Icon;

const toolIcons: Record<string, ToolIcon> = {
  compose_email: PencilEdit01Icon,
  create_google_calendar_event: Calendar01Icon,
  get_mailbox_overview: Mailbox01Icon,
  list_gmail_labels: Tag01Icon,
  memory: Brain01Icon,
  modify_mail: Archive01Icon,
  read_gmail_attachment: Attachment01Icon,
  read_gmail_message: Mail01Icon,
  read_gmail_messages: Mail01Icon,
  read_gmail_thread: Comment01Icon,
  search_gmail: Search01Icon,
};

const toolLabels: Record<string, { complete: string; pending: string }> = {
  compose_email: { complete: "Prepared email", pending: "Preparing email" },
  create_google_calendar_event: {
    complete: "Added calendar event",
    pending: "Adding calendar event",
  },
  get_mailbox_overview: {
    complete: "Checked mailbox",
    pending: "Checking mailbox",
  },
  list_gmail_labels: { complete: "Listed labels", pending: "Listing labels" },
  memory: { complete: "Updated memory", pending: "Updating memory" },
  modify_mail: { complete: "Updated mail", pending: "Updating mail" },
  read_gmail_attachment: {
    complete: "Read attachment",
    pending: "Reading attachment",
  },
  read_gmail_message: {
    complete: "Read message",
    pending: "Reading message",
  },
  read_gmail_messages: {
    complete: "Read messages",
    pending: "Reading messages",
  },
  read_gmail_thread: { complete: "Read thread", pending: "Reading thread" },
  search_gmail: { complete: "Searched mail", pending: "Searching mail" },
};

const truncate = (value: string, maxLength = 54) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;

const getToolDetail = (name: string, args: Record<string, unknown>) => {
  switch (name) {
    case "compose_email": {
      return getString(args, "subject");
    }
    case "create_google_calendar_event": {
      return getString(args, "summary");
    }
    case "modify_mail": {
      return [
        getString(args, "action").replaceAll("_", " "),
        getString(args, "target"),
      ]
        .filter((value) => value !== "")
        .join(" ");
    }
    case "read_gmail_attachment": {
      return getString(args, "attachmentId");
    }
    case "read_gmail_message": {
      return getString(args, "messageId");
    }
    case "read_gmail_thread": {
      return getString(args, "threadId");
    }
    case "search_gmail": {
      return getString(args, "query");
    }
    default: {
      return "";
    }
  }
};

const getResultError = (result: ToolResult | undefined, data: unknown) => {
  if (result?.state === "error") {
    return result.error ?? "The tool could not finish.";
  }
  return isRecord(data) &&
    data.status === "error" &&
    typeof data.error === "string"
    ? data.error
    : "";
};

const ResultList = ({
  items,
  onOpenMessage,
}: {
  items: unknown[];
  onOpenMessage: (category: string, messageId: string) => void;
}) => (
  <div className="space-y-1">
    {items.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const id = getString(item, "id");
      const subject = getString(item, "subject") || "(No subject)";
      const from = getString(item, "from");
      const category = getString(item, "category");
      const row = (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-fg/85">{subject}</span>
          {from === "" ? null : (
            <span className="max-w-40 shrink-0 truncate text-muted-fg">
              {from}
            </span>
          )}
        </span>
      );
      return [
        id !== "" && category !== "" ? (
          <button
            className="flex w-full rounded-sm py-1 text-left text-caption transition-colors hover:text-fg"
            key={id}
            onClick={() => {
              onOpenMessage(category, id);
            }}
            type="button"
          >
            {row}
          </button>
        ) : (
          <div className="flex py-1 text-caption" key={id || subject}>
            {row}
          </div>
        ),
      ];
    })}
  </div>
);

const OverviewResult = ({ data }: { data: Record<string, unknown> }) => {
  const entries = [
    ["Messages", data.totalMessages],
    ["Threads", data.totalThreads],
    ["Unread", data.unreadMessages],
    ["Starred", data.starredMessages],
    ["Attachments", data.attachmentMessages],
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number");
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-caption">
      {entries.map(([label, value]) => (
        <div className="flex justify-between gap-3" key={label}>
          <dt className="text-muted-fg">{label}</dt>
          <dd className="text-fg/80 tabular-nums">{value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
};

// Tool payloads intentionally share one compact renderer with specialized branches.
// eslint-disable-next-line complexity
const ToolResultContent = ({
  data,
  name,
  onOpenMessage,
}: {
  data: unknown;
  name: string;
  onOpenMessage: (category: string, messageId: string) => void;
}): ReactNode => {
  if (!isRecord(data)) {
    return data === null || data === undefined ? null : (
      <pre className="max-h-64 overflow-auto text-caption whitespace-pre-wrap text-muted-fg">
        {truncate(JSON.stringify(data), 4000)}
      </pre>
    );
  }
  if (name === "get_mailbox_overview") {
    return <OverviewResult data={data} />;
  }
  if (name === "search_gmail" || name === "read_gmail_messages") {
    return (
      <ResultList
        items={Array.isArray(data.messages) ? data.messages : []}
        onOpenMessage={(category, messageId) => {
          onOpenMessage(category || getString(data, "category"), messageId);
        }}
      />
    );
  }
  if (name === "read_gmail_thread") {
    return (
      <div className="space-y-3">
        <p className="text-body font-medium">
          {getString(data, "subject") || "(No subject)"}
        </p>
        {(Array.isArray(data.messages) ? data.messages : []).flatMap(
          (message) =>
            isRecord(message)
              ? [
                  <div
                    className="border-l border-border pl-3"
                    key={getString(message, "id")}
                  >
                    <p className="truncate text-caption text-muted-fg">
                      {getString(message, "from") || "Unknown sender"}
                    </p>
                    <p className="mt-1 line-clamp-5 text-caption/relaxed whitespace-pre-wrap text-fg/80">
                      {getString(message, "body") ||
                        getString(message, "snippet") ||
                        "(No content)"}
                    </p>
                  </div>,
                ]
              : []
        )}
      </div>
    );
  }
  if (name === "read_gmail_message") {
    const id = getString(data, "id");
    const category = getString(data, "category");
    return (
      <button
        className="block w-full text-left"
        disabled={id === "" || category === ""}
        onClick={() => {
          onOpenMessage(category, id);
        }}
        type="button"
      >
        <p className="text-body font-medium">
          {getString(data, "subject") || "(No subject)"}
        </p>
        <p className="mt-1 text-caption text-muted-fg">
          {getString(data, "from")}
        </p>
        <p className="mt-2 line-clamp-8 text-caption/relaxed whitespace-pre-wrap text-fg/80">
          {getString(data, "body") ||
            getString(data, "snippet") ||
            "(No content)"}
        </p>
      </button>
    );
  }
  if (name === "read_gmail_attachment") {
    return (
      <div>
        <p className="text-caption font-medium">
          {getString(data, "fileName")}
        </p>
        <pre className="mt-2 max-h-64 overflow-auto text-caption/relaxed whitespace-pre-wrap text-muted-fg">
          {truncate(getString(data, "content"), 4000)}
        </pre>
      </div>
    );
  }
  if (name === "list_gmail_labels") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {(Array.isArray(data.labels) ? data.labels : []).flatMap((label) =>
          isRecord(label)
            ? [
                <span
                  className="rounded-md bg-muted px-2 py-1 text-micro text-muted-fg"
                  key={getString(label, "id")}
                >
                  {getString(label, "name")}
                </span>,
              ]
            : []
        )}
      </div>
    );
  }
  const answer = getString(data, "answer");
  if (name === "memory" && answer !== "") {
    return (
      <p className="text-caption/relaxed whitespace-pre-wrap text-muted-fg">
        {answer}
      </p>
    );
  }
  const link = getString(data, "htmlLink");
  if (name === "create_google_calendar_event" && link !== "") {
    return (
      <a
        className="text-link text-caption hover:underline"
        href={link}
        rel="noreferrer"
        target="_blank"
      >
        Open calendar event
      </a>
    );
  }
  return (
    <pre className="max-h-64 overflow-auto text-caption whitespace-pre-wrap text-muted-fg">
      {truncate(JSON.stringify(data, null, 2), 4000)}
    </pre>
  );
};

const GenericApproval = ({
  approval,
  args,
  disabled,
}: {
  approval: ChatToolApproval;
  args: Record<string, unknown>;
  disabled: boolean;
}) => (
  <div className="space-y-3">
    <pre className="max-h-56 overflow-auto text-caption whitespace-pre-wrap text-muted-fg">
      {truncate(JSON.stringify(args, null, 2), 4000)}
    </pre>
    <div className="flex justify-end gap-2">
      <Button
        disabled={disabled}
        onClick={() => {
          approval.reject();
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        Decline
      </Button>
      <Button
        disabled={disabled}
        onClick={() => {
          approval.approve();
        }}
        size="sm"
        type="button"
      >
        Approve
      </Button>
    </div>
  </div>
);

const getToolLabel = (input: {
  awaitingApproval: boolean;
  name: string;
  pending: boolean;
}) => {
  if (input.awaitingApproval) {
    return `Approve ${humanizeToolName(input.name).toLowerCase()}`;
  }
  const labels = toolLabels[input.name];
  if (input.pending) {
    return labels?.pending ?? `Running ${humanizeToolName(input.name)}`;
  }
  return labels?.complete ?? humanizeToolName(input.name);
};

// State, approval, specialized details, and disclosure all converge in this row.
// eslint-disable-next-line complexity
export const ToolActivity = ({
  approval,
  call,
  isStreaming,
  result,
  resuming,
}: {
  approval?: ChatToolApproval;
  call: ToolCall;
  isStreaming: boolean;
  result?: ToolResult;
  resuming: boolean;
}) => {
  const navigate = useNavigate({ from: "/" });
  const args = parseToolArguments(call.input ?? call.arguments);
  const data = parseToolResult(call.name, result?.content);
  const error = getResultError(result, data);
  const awaitingApproval = approval !== undefined && result === undefined;
  const pending = result === undefined && !awaitingApproval && isStreaming;
  const shouldExpand = awaitingApproval || pending || error !== "";
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const open = shouldExpand || manuallyOpen;
  const label = getToolLabel({
    awaitingApproval,
    name: call.name,
    pending,
  });
  const detail = getToolDetail(call.name, args);
  const actionsDisabled =
    resuming ||
    approval?.canResolve === false ||
    approval?.status === "submitting" ||
    approval?.status === "validating";
  const composeInput =
    call.name === "compose_email" && approval !== undefined
      ? composeEmailInputSchema.safeParse(approval.originalArgs)
      : null;
  let content: ReactNode;
  if (awaitingApproval && composeInput?.success === true) {
    content = (
      <ComposeToolApproval
        disabled={actionsDisabled}
        initial={composeInput.data}
        onApprove={(editedArgs) => {
          approval.approve(editedArgs);
        }}
        onReject={() => {
          approval.reject();
        }}
      />
    );
  } else if (awaitingApproval && approval !== undefined) {
    content = (
      <GenericApproval
        approval={approval}
        args={args}
        disabled={actionsDisabled}
      />
    );
  } else {
    content = (
      <ToolResultContent
        data={data}
        name={call.name}
        onOpenMessage={(category, messageId) => {
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
        }}
      />
    );
  }
  const expandable = content !== null && content !== undefined;
  let statusIcon = toolIcons[call.name] ?? Wrench01Icon;
  if (pending || resuming) {
    statusIcon = Loading03Icon;
  }
  if (error !== "") {
    statusIcon = Alert02Icon;
  }

  return (
    <Collapsible onOpenChange={setManuallyOpen} open={open}>
      <div className="py-0.5">
        <CollapsibleTrigger
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
          className="group flex w-full items-center gap-2.5 rounded-md py-1 text-left"
          disabled={!expandable}
        >
          <HugeiconsIcon
            aria-hidden
            className={cn("size-3.5 shrink-0", {
              "animate-spin text-muted-fg": pending || resuming,
              "text-destructive": error !== "",
              "text-muted-fg/70": !pending && !resuming && error === "",
            })}
            icon={statusIcon}
          />
          <span className="min-w-0 flex-1 truncate text-body text-muted-fg">
            {label}
            {detail === "" ? null : (
              <span className="ml-2 text-fg/70">{truncate(detail)}</span>
            )}
            {error === "" ? null : (
              <span className="ml-2 text-destructive/90">
                {truncate(error)}
              </span>
            )}
          </span>
          {expandable ? (
            <HugeiconsIcon
              aria-hidden
              className={cn("size-3.5 text-muted-fg/45 transition-transform", {
                "rotate-90": open,
              })}
              icon={ArrowRight01Icon}
            />
          ) : (
            <HugeiconsIcon
              aria-hidden
              className="size-3.5 text-muted-fg/40"
              icon={CheckmarkCircle02Icon}
            />
          )}
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="min-h-0 overflow-hidden pl-6">
            <div className="mt-1.5 rounded-lg border border-border bg-bg-surface p-3">
              {content}
            </div>
          </div>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
};
