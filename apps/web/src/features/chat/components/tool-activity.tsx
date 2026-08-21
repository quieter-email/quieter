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
import {
  aiMemoryResultSchema,
  composeEmailResultSchema,
  gmailAttachmentResultSchema,
  gmailLabelListResultSchema,
  gmailMessageResultSchema,
  gmailMessagesResultSchema,
  gmailSearchResultSchema,
  gmailThreadResultSchema,
  googleCalendarCreateEventResultSchema,
  mailboxOverviewResultSchema,
} from "@quieter/ai/chat-agent";
import type { MailboxOverviewResult } from "@quieter/ai/chat-agent";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@quieter/ui/collapsible";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { getToolName, humanizeToolName } from "../domain/chat-tools";
import type { ChatToolApproval, ChatToolPart } from "../domain/chat-tools";
import { parseComposeProposal } from "../domain/compose-proposal";
import { ComposeToolApproval } from "./compose-tool-approval";

type ToolIcon = typeof Wrench01Icon;

const TOOL_PART_TERMINAL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

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
      return typeof args.subject === "string" ? args.subject : "";
    }
    case "create_google_calendar_event": {
      return typeof args.summary === "string" ? args.summary : "";
    }
    case "modify_mail": {
      return [
        typeof args.action === "string" ? args.action.replaceAll("_", " ") : "",
        typeof args.target === "string" ? args.target : "",
      ]
        .filter((value) => value !== "")
        .join(" ");
    }
    case "read_gmail_attachment": {
      return typeof args.attachmentId === "string" ? args.attachmentId : "";
    }
    case "read_gmail_message": {
      return typeof args.messageId === "string" ? args.messageId : "";
    }
    case "read_gmail_thread": {
      return typeof args.threadId === "string" ? args.threadId : "";
    }
    case "search_gmail": {
      return typeof args.query === "string" ? args.query : "";
    }
    default: {
      return "";
    }
  }
};

const getResultError = (part: ChatToolPart, data: unknown) => {
  if (part.state === "output-error") {
    return typeof part.errorText === "string"
      ? part.errorText
      : "The tool could not finish.";
  }
  if (part.state === "output-denied") {
    return "You declined this action.";
  }
  return typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    "status" in data &&
    data.status === "error" &&
    "error" in data &&
    typeof data.error === "string"
    ? data.error
    : "";
};

const RawJson = ({ value }: { value: unknown }) => (
  <pre className="max-h-64 overflow-auto text-caption whitespace-pre-wrap text-muted-fg">
    {truncate(JSON.stringify(value, null, 2), 4000)}
  </pre>
);

const ResultList = ({
  category,
  items,
  onOpenMessage,
}: {
  category?: string;
  items: {
    category?: string;
    from?: string;
    id: string;
    subject?: string;
  }[];
  onOpenMessage: (category: string, messageId: string) => void;
}) => (
  <div className="space-y-1">
    {items.map((item) => {
      const itemCategory = item.category ?? category ?? "";
      const from = item.from ?? "";
      const subject = item.subject ?? "";
      const row = (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-fg/85">
            {subject === "" ? "(No subject)" : subject}
          </span>
          {from === "" ? null : (
            <span className="max-w-40 shrink-0 truncate text-muted-fg">
              {from}
            </span>
          )}
        </span>
      );
      return itemCategory === "" ? (
        <div className="flex py-1 text-caption" key={item.id}>
          {row}
        </div>
      ) : (
        <button
          className="flex w-full rounded-sm py-1 text-left text-caption transition-colors hover:text-fg"
          key={item.id}
          onClick={() => {
            onOpenMessage(itemCategory, item.id);
          }}
          type="button"
        >
          {row}
        </button>
      );
    })}
  </div>
);

const OverviewResult = ({ data }: { data: MailboxOverviewResult }) => {
  if (data.status !== "success") {
    return null;
  }
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
const ToolResultContent = ({
  data,
  name,
  onOpenMessage,
}: {
  data: unknown;
  name: string;
  onOpenMessage: (category: string, messageId: string) => void;
}): ReactNode => {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return data === null || data === undefined ? null : (
      <RawJson value={data} />
    );
  }

  if (name === "get_mailbox_overview") {
    const parsed = mailboxOverviewResultSchema.safeParse(data);
    return parsed.success ? <OverviewResult data={parsed.data} /> : null;
  }

  if (name === "search_gmail") {
    const parsed = gmailSearchResultSchema.safeParse(data);
    if (!parsed.success || parsed.data.status !== "success") {
      return null;
    }
    return (
      <ResultList
        category={parsed.data.category}
        items={parsed.data.messages}
        onOpenMessage={onOpenMessage}
      />
    );
  }

  if (name === "read_gmail_messages") {
    const parsed = gmailMessagesResultSchema.safeParse(data);
    if (!parsed.success || parsed.data.status !== "success") {
      return null;
    }
    return (
      <ResultList items={parsed.data.messages} onOpenMessage={onOpenMessage} />
    );
  }

  if (name === "read_gmail_thread") {
    const parsed = gmailThreadResultSchema.safeParse(data);
    if (!parsed.success || parsed.data.status !== "success") {
      return null;
    }
    const subject = parsed.data.subject ?? "";
    return (
      <div className="space-y-3">
        <p className="text-body font-medium">
          {subject === "" ? "(No subject)" : subject}
        </p>
        {parsed.data.messages.map((message) => {
          const from = message.from ?? "";
          const content = message.body === "" ? message.snippet : message.body;
          return (
            <div className="border-l border-border pl-3" key={message.id}>
              <p className="truncate text-caption text-muted-fg">
                {from === "" ? "Unknown sender" : from}
              </p>
              <p className="mt-1 line-clamp-5 text-caption/relaxed whitespace-pre-wrap text-fg/80">
                {content === undefined || content === ""
                  ? "(No content)"
                  : content}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  if (name === "read_gmail_message") {
    const parsed = gmailMessageResultSchema.safeParse(data);
    if (!parsed.success || parsed.data.status !== "success") {
      return null;
    }
    const { body, category, from, id, snippet, subject } = parsed.data;
    const content = body === "" ? snippet : body;
    return (
      <button
        className="block w-full text-left"
        onClick={() => {
          onOpenMessage(category, id);
        }}
        type="button"
      >
        <p className="text-body font-medium">
          {subject === undefined || subject === "" ? "(No subject)" : subject}
        </p>
        <p className="mt-1 text-caption text-muted-fg">{from}</p>
        <p className="mt-2 line-clamp-8 text-caption/relaxed whitespace-pre-wrap text-fg/80">
          {content === undefined || content === "" ? "(No content)" : content}
        </p>
      </button>
    );
  }

  if (name === "read_gmail_attachment") {
    const parsed = gmailAttachmentResultSchema.safeParse(data);
    if (!parsed.success || parsed.data.status !== "success") {
      return null;
    }
    return (
      <div>
        <p className="text-caption font-medium">{parsed.data.fileName}</p>
        <pre className="mt-2 max-h-64 overflow-auto text-caption/relaxed whitespace-pre-wrap text-muted-fg">
          {truncate(parsed.data.content, 4000)}
        </pre>
      </div>
    );
  }

  if (name === "list_gmail_labels") {
    const parsed = gmailLabelListResultSchema.safeParse(data);
    if (!parsed.success || parsed.data.status !== "success") {
      return null;
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {parsed.data.labels.map((label) => (
          <span
            className="rounded-md bg-muted px-2 py-1 text-micro text-muted-fg"
            key={label.id}
          >
            {label.name}
          </span>
        ))}
      </div>
    );
  }

  if (name === "memory") {
    const parsed = aiMemoryResultSchema.safeParse(data);
    if (
      !parsed.success ||
      parsed.data.answer === undefined ||
      parsed.data.answer === ""
    ) {
      return null;
    }
    return (
      <p className="text-caption/relaxed whitespace-pre-wrap text-muted-fg">
        {parsed.data.answer}
      </p>
    );
  }

  if (name === "create_google_calendar_event") {
    const parsed = googleCalendarCreateEventResultSchema.safeParse(data);
    if (!parsed.success || parsed.data.status !== "success") {
      return null;
    }
    return parsed.data.htmlLink === undefined ? null : (
      <a
        className="text-link text-caption hover:underline"
        href={parsed.data.htmlLink}
        rel="noreferrer"
        target="_blank"
      >
        Open calendar event
      </a>
    );
  }

  if (name === "compose_email") {
    const parsed = composeEmailResultSchema.safeParse(data);
    if (!parsed.success) {
      return null;
    }
    if (parsed.data.status === "sent") {
      return (
        <p className="text-caption/relaxed text-muted-fg">
          Sent to {parsed.data.to}
        </p>
      );
    }
    if (parsed.data.status === "draft_saved") {
      return (
        <p className="text-caption/relaxed text-muted-fg">
          Draft saved to {parsed.data.to}
        </p>
      );
    }
    return <p className="text-caption/relaxed text-muted-fg">Declined</p>;
  }

  return <RawJson value={data} />;
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
    <RawJson value={args} />
    <div className="flex justify-end gap-2">
      <Button
        disabled={disabled}
        onClick={() => {
          approval.deny();
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
  name: string;
  pending: boolean;
  waitingForUser: boolean;
}) => {
  if (input.waitingForUser) {
    return `Approve ${humanizeToolName(input.name).toLowerCase()}`;
  }
  const labels = toolLabels[input.name];
  if (input.pending) {
    return labels?.pending ?? `Running ${humanizeToolName(input.name)}`;
  }
  return labels?.complete ?? humanizeToolName(input.name);
};

export type ComposeSubmitAction = "send" | "save_draft";

export const ToolActivity = ({
  approval,
  composeBusy,
  isStreaming,
  onComposeDecline,
  onComposeSubmit,
  part,
}: {
  approval?: ChatToolApproval;
  composeBusy: boolean;
  isStreaming: boolean;
  onComposeDecline: (toolCallId: string) => void;
  onComposeSubmit: (
    toolCallId: string,
    action: ComposeSubmitAction,
    values: {
      bcc: string;
      bodyText: string;
      cc: string;
      subject: string;
      to: string;
    }
  ) => void;
  part: ChatToolPart;
}) => {
  const navigate = useNavigate({ from: "/" });
  const name = getToolName(part.type);
  const args =
    typeof part.input === "object" &&
    part.input !== null &&
    !Array.isArray(part.input)
      ? Object.fromEntries(Object.entries(part.input))
      : {};
  const data = part.output;
  const error = getResultError(part, data);
  const composeProposal =
    name === "compose_email" ? parseComposeProposal(part) : null;
  const awaitingApproval =
    part.state === "approval-requested" || composeProposal !== null;
  const terminal = TOOL_PART_TERMINAL_STATES.has(part.state);
  const pending = !terminal && !awaitingApproval && isStreaming;
  const shouldExpand = awaitingApproval || pending || error !== "";
  // Null lets the row follow shouldExpand until the user takes over, so an
  // automatically expanded row can still be collapsed manually.
  const [manuallyOpen, setManuallyOpen] = useState<boolean | null>(null);
  const open = manuallyOpen ?? shouldExpand;
  const label = getToolLabel({
    name,
    pending,
    waitingForUser: awaitingApproval,
  });
  const detail = getToolDetail(name, args);
  let content: ReactNode;
  if (composeProposal !== null) {
    content = (
      <ComposeToolApproval
        disabled={composeBusy}
        initial={composeProposal.input}
        onDecline={() => {
          onComposeDecline(composeProposal.toolCallId);
        }}
        onSubmit={(action, values) => {
          onComposeSubmit(composeProposal.toolCallId, action, values);
        }}
      />
    );
  } else if (awaitingApproval && approval !== undefined) {
    content = (
      <GenericApproval approval={approval} args={args} disabled={false} />
    );
  } else if (awaitingApproval) {
    content = <RawJson value={args} />;
  } else {
    content = (
      <ToolResultContent
        data={data}
        name={name}
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
  const isWorking = pending;
  let statusIcon = toolIcons[name] ?? Wrench01Icon;
  if (isWorking) {
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
              "animate-spin text-muted-fg": isWorking,
              "text-destructive": error !== "",
              "text-muted-fg/70": !isWorking && error === "",
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
