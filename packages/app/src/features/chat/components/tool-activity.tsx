import {
  Alert02Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  approvalRequiredToolNames,
  isCalendarWriteToolName,
} from "@quieter/ai/chat-tools";
import { getToolName } from "@quieter/app/features/chat/domain/chat-tools";
import type {
  ChatToolApproval,
  ChatToolPart,
} from "@quieter/app/features/chat/domain/chat-tools";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@quieter/ui/collapsible";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";

const labels: Record<string, { complete: string; pending: string }> = {
  create_calendar_event: {
    complete: "Created event",
    pending: "Creating event…",
  },
  delete_calendar_event: {
    complete: "Deleted event",
    pending: "Deleting event…",
  },
  edit_compose: { complete: "Updated draft", pending: "Updating draft…" },
  get_calendar_event: { complete: "Read event", pending: "Reading event…" },
  get_workspace: {
    complete: "Checked workspace",
    pending: "Checking workspace…",
  },
  list_calendar_events: {
    complete: "Checked calendar events",
    pending: "Checking calendar events…",
  },
  list_calendars: {
    complete: "Checked calendars",
    pending: "Checking calendars…",
  },
  modify_mail: {
    complete: "Updated conversation",
    pending: "Updating conversation…",
  },
  navigate: { complete: "Opened view", pending: "Opening view…" },
  navigate_calendar: {
    complete: "Opened calendar",
    pending: "Opening calendar…",
  },
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
  respond_to_calendar_event: {
    complete: "Responded to invitation",
    pending: "Responding to invitation…",
  },
  save_compose_draft: { complete: "Saved draft", pending: "Saving draft…" },
  search_gmail: { complete: "Searched mail", pending: "Searching mail…" },
  send_mail: { complete: "Sent email", pending: "Sending email…" },
  update_calendar_event: {
    complete: "Updated event",
    pending: "Updating event…",
  },
};

const CalendarApprovalDetails = ({
  approval,
}: {
  approval: ChatToolApproval;
}) => {
  const review = approval.calendarReview;
  if (review === undefined) {
    return (
      <p className="text-caption text-muted-fg">
        The destination calendar and event need to be read before this action
        can be approved.
      </p>
    );
  }
  const time =
    review.time.kind === "all-day"
      ? `${review.time.startDate} until ${review.time.endDate}, all day, end date excluded`
      : `${new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: review.time.timeZone,
        }).formatRange(
          new Date(review.time.start),
          new Date(review.time.end)
        )}, ${review.time.timeZone}`;
  const details = [
    ["Event", review.title],
    ["When", time],
    ["Account", review.account.email ?? review.account.name],
    ["Calendar", review.calendar.name],
    [
      "Applies to",
      {
        event: "This event",
        occurrence: "This occurrence only",
        series: "The entire series",
      }[review.scope],
    ],
    ["Guests", "Guests will be notified."],
  ];
  return (
    <dl className="space-y-2 text-caption">
      {details.map(([label, value]) => (
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2" key={label}>
          <dt className="text-muted-fg">{label}</dt>
          <dd className="break-words whitespace-pre-wrap text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
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
  const approvalAction =
    {
      create_calendar_event: "Create event",
      delete_calendar_event: "Delete",
      respond_to_calendar_event: "Send response",
      send_mail: "Send",
      update_calendar_event: "Save changes",
    }[name] ?? "Approve";
  const awaitingApproval =
    approvalRequiredToolNames.includes(name) &&
    part.state === "approval-requested";
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
    label =
      {
        create_calendar_event: "Create this event?",
        delete_calendar_event: "Delete this event permanently?",
        respond_to_calendar_event: "Send this invitation response?",
        send_mail: "Send this email?",
        update_calendar_event: "Save these event changes?",
      }[name] ?? "Approve this action?";
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
        <IconButtonTooltip label="Action details">
          <CollapsibleTrigger
            aria-label="Action details"
            render={<Button size="icon-xs" variant="ghost" />}
          >
            <HugeiconsIcon aria-hidden icon={ArrowDown01Icon} />
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
          {awaitingApproval && approval && isCalendarWriteToolName(name) ? (
            <div className="mb-3">
              <CalendarApprovalDetails approval={approval} />
            </div>
          ) : null}
          <ToolDetails draft={draft} input={part.input} />
          {awaitingApproval && approval ? (
            <ActionFooter className="mt-3">
              <Button
                disabled={isStreaming}
                onClick={() => {
                  approval.deny();
                }}
                size="compact"
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                disabled={isStreaming}
                onClick={() => {
                  approval.approve();
                }}
                size="compact"
                type="button"
                variant={
                  name === "delete_calendar_event" ? "destructive" : "default"
                }
              >
                {approvalAction}
              </Button>
            </ActionFooter>
          ) : null}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
};
