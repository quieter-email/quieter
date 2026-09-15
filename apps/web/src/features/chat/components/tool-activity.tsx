import {
  Alert02Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@quieter/ui/collapsible";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";

import { getToolName } from "../domain/chat-tools";
import type { ChatToolApproval, ChatToolPart } from "../domain/chat-tools";

const labels: Record<string, { complete: string; pending: string }> = {
  edit_compose: { complete: "Updated draft", pending: "Updating draft…" },
  get_workspace: {
    complete: "Checked workspace",
    pending: "Checking workspace…",
  },
  modify_mail: {
    complete: "Updated conversation",
    pending: "Updating conversation…",
  },
  navigate: { complete: "Opened view", pending: "Opening view…" },
  open_compose: { complete: "Opened draft", pending: "Opening draft…" },
  read_gmail_message: { complete: "Read message", pending: "Reading message…" },
  read_gmail_messages: {
    complete: "Read messages",
    pending: "Reading messages…",
  },
  read_gmail_thread: {
    complete: "Read conversation",
    pending: "Reading conversation…",
  },
  save_compose_draft: { complete: "Saved draft", pending: "Saving draft…" },
  search_gmail: { complete: "Searched mail", pending: "Searching mail…" },
  send_mail: { complete: "Sent email", pending: "Sending email…" },
};
const changeQuestions: Record<string, string> = {
  archive: "Archive this conversation?",
  mark_read: "Mark as read?",
  mark_unread: "Mark as unread?",
  move_to_inbox: "Move to inbox?",
  move_to_spam: "Move to spam?",
  move_to_trash: "Move to trash?",
  trash: "Move to trash?",
};

const ToolDetails = ({ input, draft }: { input: unknown; draft: boolean }) => {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  let payload = input;
  if (
    "draft" in input &&
    typeof input.draft === "object" &&
    input.draft !== null
  ) {
    payload = input.draft;
  }
  const fields = draft
    ? ([
        ["To", "to"],
        ["Cc", "cc"],
        ["Bcc", "bcc"],
        ["Subject", "subject"],
        ["Message", "bodyText"],
      ] as const)
    : ([
        ["Search", "query"],
        ["Change", "action"],
        ["Target", "target"],
        ["Conversation", "threadId"],
        ["Message", "messageId"],
        ["Item", "id"],
        ["View", "view"],
      ] as const);
  const details: { key: string; label: string; value: string }[] =
    fields.flatMap(([label, key]) => {
      const value: unknown = Reflect.get(payload, key);
      return typeof value === "string" && value !== ""
        ? [{ key, label, value }]
        : [];
    });
  if (details.length === 0) {
    for (const [key, value] of Object.entries(payload)) {
      details.push({
        key,
        label: key.replaceAll("_", " "),
        value:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      });
    }
  }
  return (
    <dl className="max-h-48 space-y-2 overflow-y-auto text-caption">
      {details.map(({ label, key, value }) => (
        <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2" key={key}>
          <dt className="text-muted-fg">{label}</dt>
          <dd className="break-words whitespace-pre-wrap text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
};

export const ToolActivity = ({
  approval,
  isStreaming,
  part,
}: {
  approval?: ChatToolApproval;
  isStreaming: boolean;
  part: ChatToolPart;
}) => {
  const name = getToolName(part.type);
  const awaitingApproval = part.state === "approval-requested";
  const output = part.state === "output-available" ? part.output : undefined;
  const returnedError =
    typeof output === "object" &&
    output !== null &&
    "status" in output &&
    output.status === "error";
  const failed = part.state === "output-error" || returnedError;
  const pending =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (part.state === "approval-responded" && part.approval.approved);
  const draft =
    name === "send_mail" ||
    name === "save_compose_draft" ||
    name === "open_compose" ||
    name === "edit_compose";
  const wording = labels[name] ?? {
    complete: "Completed action",
    pending: "Working…",
  };
  let label = wording.complete;
  let icon = CheckmarkCircle02Icon;
  if (pending) {
    label = wording.pending;
    icon = Loading03Icon;
  }
  if (failed) {
    label = "Action could not be completed";
    icon = Alert02Icon;
  }
  if (part.state === "output-denied") {
    label = "Skipped";
  }
  if (awaitingApproval) {
    label = "Apply this change?";
    if (name === "send_mail") {
      label = "Send this email?";
    } else if (name === "save_compose_draft") {
      label = "Save this draft?";
    } else if (
      typeof part.input === "object" &&
      part.input !== null &&
      "action" in part.input &&
      typeof part.input.action === "string"
    ) {
      label = changeQuestions[part.input.action] ?? "Update this conversation?";
    }
  }
  let errorText = "The action could not be completed. Try again.";
  if (part.state === "output-error") {
    ({ errorText } = part);
  } else if (
    returnedError &&
    "error" in output &&
    typeof output.error === "string"
  ) {
    errorText = output.error;
  }

  return (
    <Collapsible
      defaultOpen={awaitingApproval}
      key={awaitingApproval ? "approval" : "activity"}
    >
      <div className="flex min-h-7 items-center gap-2 text-caption">
        {awaitingApproval ? null : (
          <HugeiconsIcon
            aria-hidden
            className={cn("size-3.5 shrink-0 text-muted-fg", {
              "animate-spin motion-reduce:animate-none": pending,
              "text-destructive": failed,
            })}
            icon={icon}
          />
        )}
        <span
          className={cn("min-w-0 text-muted-fg", {
            "flex-1": awaitingApproval,
          })}
        >
          {label}
        </span>
        {awaitingApproval && approval ? (
          <>
            <Button
              disabled={isStreaming}
              onClick={() => {
                approval.approve();
              }}
              size="compact"
              type="button"
              variant="ghost"
            >
              Apply
            </Button>
            <Button
              disabled={isStreaming}
              onClick={() => {
                approval.deny();
              }}
              size="compact"
              type="button"
              variant="ghost"
            >
              Skip
            </Button>
          </>
        ) : null}
        <IconButtonTooltip label="Action details">
          <CollapsibleTrigger
            aria-label="Action details"
            // oxlint-disable-next-line shadcn/no-restyle -- Details chevron keeps its compact icon treatment.
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-fg hover:text-fg focus-visible:ring-1 focus-visible:ring-ring"
          >
            <HugeiconsIcon
              aria-hidden
              className="size-3"
              icon={ArrowDown01Icon}
            />
          </CollapsibleTrigger>
        </IconButtonTooltip>
      </div>
      {failed ? (
        <output className="mt-1 block text-caption text-muted-fg">
          {errorText}
        </output>
      ) : null}
      <CollapsiblePanel>
        <div className="py-2">
          <ToolDetails draft={draft} input={part.input} />
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
};
