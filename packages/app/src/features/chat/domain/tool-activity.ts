import {
  gmailAttachmentResultSchema,
  gmailLabelListResultSchema,
  gmailMessageResultSchema,
  gmailMessagesResultSchema,
  gmailSearchResultSchema,
  gmailThreadResultSchema,
  linearToolCallInputSchema,
  mailboxOverviewResultSchema,
  modifyMailResultSchema,
} from "@quieter/ai/chat-agent";
import {
  calendarEventsToolResultSchema,
  calendarEventToolResultSchema,
  calendarListToolResultSchema,
  calendarToolErrorSchema,
  editComposeInputSchema,
  editComposeOutputSchema,
  getWorkspaceOutputSchema,
  openComposeInputSchema,
  openComposeOutputSchema,
  openInlineComposeInputSchema,
  openInlineComposeOutputSchema,
  requiresChatToolApproval,
  saveComposeDraftInputSchema,
  saveComposeDraftOutputSchema,
  sendMailOutputSchema,
} from "@quieter/ai/chat-tools";
import {
  getToolName,
  humanizeToolName,
  isChatToolPart,
} from "@quieter/app/features/chat/domain/chat-tools";
import type {
  ChatToolApproval,
  ChatToolPart,
} from "@quieter/app/features/chat/domain/chat-tools";
import { parseMailReference } from "@quieter/app/features/chat/domain/mail-reference";
import { calendarMutationResultSchema } from "@quieter/calendar";
import type { CalendarEventTime } from "@quieter/calendar";
import type { UIMessage } from "ai";

type ActivityCategory =
  | "mail"
  | "search"
  | "calendar"
  | "draft"
  | "connection"
  | "workspace";
type MailSource = NonNullable<ReturnType<typeof parseMailReference>>;

export type RoutineActivity = {
  category: ActivityCategory;
  context: string[];
  id: string;
  kind: "operation";
  phase: "running" | "complete" | "skipped" | "unavailable";
  sources: MailSource[];
  title: string;
};

export type ExceptionalActivity =
  | {
      category: ActivityCategory;
      id: string;
      kind: "failure";
      message: string;
      sources: MailSource[];
      title: string;
    }
  | {
      approval: ChatToolApproval | null;
      id: string;
      input: unknown;
      kind: "approval";
      title: string;
    };

export type ChatActivitySegment =
  | { id: string; kind: "text"; text: string }
  | {
      id: string;
      kind: "activity";
      steps: [RoutineActivity, ...RoutineActivity[]];
    }
  | ExceptionalActivity;

const operations: Record<
  string,
  {
    category: ActivityCategory;
    complete: string;
    failed: string;
    pending: string;
    subject: string;
  }
> = {
  connector_list_tools: {
    category: "connection",
    complete: "Checked your connected account",
    failed: "Couldn't check this connected account",
    pending: "Checking your connected account…",
    subject: "Connected account",
  },
  connector_read: {
    category: "connection",
    complete: "Read connected content",
    failed: "Couldn't read the connected content",
    pending: "Reading connected content…",
    subject: "Connected content",
  },
  connector_write: {
    category: "connection",
    complete: "Updated your connected account",
    failed: "Couldn't complete this change",
    pending: "Updating your connected account…",
    subject: "Connected account update",
  },
  create_calendar_event: {
    category: "calendar",
    complete: "Created an event",
    failed: "Couldn't create the event",
    pending: "Creating an event…",
    subject: "Calendar event",
  },
  delete_calendar_event: {
    category: "calendar",
    complete: "Deleted the event",
    failed: "Couldn't delete the event",
    pending: "Deleting the event…",
    subject: "Calendar event",
  },
  edit_compose: {
    category: "draft",
    complete: "Updated your draft",
    failed: "Couldn't update your draft",
    pending: "Updating your draft…",
    subject: "Draft",
  },
  get_calendar_event: {
    category: "calendar",
    complete: "Read the event",
    failed: "Couldn't load this event",
    pending: "Reading the event…",
    subject: "Calendar event",
  },
  get_mailbox_overview: {
    category: "mail",
    complete: "Checked your mailbox",
    failed: "Couldn't check your mailbox",
    pending: "Checking your mailbox…",
    subject: "Mailbox overview",
  },
  get_workspace: {
    category: "workspace",
    complete: "Checked your workspace",
    failed: "Couldn't read the current view",
    pending: "Checking your workspace…",
    subject: "Workspace",
  },
  linear_list_tools: {
    category: "connection",
    complete: "Checked your connected account",
    failed: "Couldn't check this connected account",
    pending: "Checking your connected account…",
    subject: "Connected account",
  },
  linear_read: {
    category: "connection",
    complete: "Read connected content",
    failed: "Couldn't read the connected content",
    pending: "Reading connected content…",
    subject: "Connected content",
  },
  linear_write: {
    category: "connection",
    complete: "Updated your connected account",
    failed: "Couldn't complete this change",
    pending: "Updating your connected account…",
    subject: "Connected account update",
  },
  list_calendar_events: {
    category: "calendar",
    complete: "Checked your calendar",
    failed: "Couldn't load your calendar",
    pending: "Checking your calendar…",
    subject: "Calendar events",
  },
  list_calendars: {
    category: "calendar",
    complete: "Checked your calendars",
    failed: "Couldn't load your calendars",
    pending: "Checking your calendars…",
    subject: "Calendars",
  },
  list_gmail_labels: {
    category: "mail",
    complete: "Checked your mail labels",
    failed: "Couldn't load your mail labels",
    pending: "Checking your mail labels…",
    subject: "Mail labels",
  },
  modify_mail: {
    category: "mail",
    complete: "Updated your mail",
    failed: "Couldn't update your mail",
    pending: "Updating your mail…",
    subject: "Mail update",
  },
  navigate: {
    category: "workspace",
    complete: "Opened your mail",
    failed: "Couldn't open your mail",
    pending: "Opening your mail…",
    subject: "Mail workspace",
  },
  navigate_calendar: {
    category: "calendar",
    complete: "Opened your calendar",
    failed: "Couldn't open your calendar",
    pending: "Opening your calendar…",
    subject: "Calendar workspace",
  },
  open_compose: {
    category: "draft",
    complete: "Prepared your draft",
    failed: "Couldn't open a draft",
    pending: "Preparing your draft…",
    subject: "Draft",
  },
  open_inline_compose: {
    category: "draft",
    complete: "Prepared your conversation draft",
    failed: "Couldn't open a conversation draft",
    pending: "Preparing your conversation draft…",
    subject: "Conversation draft",
  },
  read_gmail_attachment: {
    category: "mail",
    complete: "Read the attachment",
    failed: "Couldn't read this attachment",
    pending: "Reading the attachment…",
    subject: "Attachment",
  },
  read_gmail_message: {
    category: "mail",
    complete: "Read the email",
    failed: "Couldn't load this email",
    pending: "Reading the email…",
    subject: "Email",
  },
  read_gmail_messages: {
    category: "mail",
    complete: "Read your emails",
    failed: "Couldn't load these emails",
    pending: "Reading your emails…",
    subject: "Emails",
  },
  read_gmail_thread: {
    category: "mail",
    complete: "Read the conversation",
    failed: "Couldn't load this conversation",
    pending: "Reading the conversation…",
    subject: "Conversation",
  },
  respond_to_calendar_event: {
    category: "calendar",
    complete: "Responded to the invitation",
    failed: "Couldn't respond to the invitation",
    pending: "Responding to the invitation…",
    subject: "Calendar invitation",
  },
  save_compose_draft: {
    category: "draft",
    complete: "Saved your draft",
    failed: "Couldn't save your draft",
    pending: "Saving your draft…",
    subject: "Draft",
  },
  search_gmail: {
    category: "search",
    complete: "Searched your mail",
    failed: "Couldn't search your mail",
    pending: "Searching your mail…",
    subject: "Mail search",
  },
  send_mail: {
    category: "draft",
    complete: "Sent your email",
    failed: "Couldn't send your email",
    pending: "Sending your email…",
    subject: "Email",
  },
  update_calendar_event: {
    category: "calendar",
    complete: "Updated the event",
    failed: "Couldn't update the event",
    pending: "Updating the event…",
    subject: "Calendar event",
  },
};

const mailSources = (
  messages: { id: string; threadId: string; subject?: string; from?: string }[]
): MailSource[] =>
  messages.flatMap((message) => {
    const query = new URLSearchParams({
      messageId: message.id,
      threadId: message.threadId,
    });
    if (message.subject) {
      query.set("subject", message.subject);
    }
    if (message.from) {
      query.set("from", message.from);
    }
    const reference = parseMailReference(`/mail-reference?${query}`);
    return reference === null ? [] : [reference];
  });

export const formatActivityTime = (time: CalendarEventTime): string => {
  if (time.kind === "all-day") {
    const format = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: "UTC",
    });
    return `${format.formatRange(new Date(time.startDate), new Date(new Date(time.endDate).getTime() - 86_400_000))}, all day`;
  }
  return `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: time.timeZone }).formatRange(new Date(time.start), new Date(time.end))}, ${time.timeZone}`;
};

const describeActivity = (
  part: ChatToolPart,
  approval: ChatToolApproval | undefined
): RoutineActivity | ExceptionalActivity => {
  const name = getToolName(part.type);
  const operation = operations[name] ?? {
    category: "connection",
    complete: "Completed your request",
    failed: "Couldn't complete your request",
    pending: "Working on your request…",
    subject: "Connected activity",
  };
  if (
    part.state === "approval-requested" &&
    requiresChatToolApproval({ input: part.input, toolName: name })
  ) {
    const command = linearToolCallInputSchema.safeParse(part.input);
    let title = "Confirm this action?";
    if (command.success) {
      title = `${humanizeToolName(command.data.toolName)}?`;
    }
    if (approval?.calendarReview) {
      title = `Delete “${approval.calendarReview.title}”?`;
    }
    return {
      approval: approval ?? null,
      id: part.toolCallId,
      input: part.input,
      kind: "approval",
      title,
    };
  }
  const returnedError =
    part.state === "output-available"
      ? calendarToolErrorSchema.safeParse(part.output)
      : null;
  if (part.state === "output-error" || returnedError?.success === true) {
    let message = "The action could not be completed. Try again.";
    if (part.state === "output-error") {
      message = part.errorText;
    } else if (returnedError?.success === true) {
      message = returnedError.data.error;
    }
    return {
      category: operation.category,
      id: part.toolCallId,
      kind: "failure",
      message,
      sources: [],
      title: operation.failed,
    };
  }
  let phase: RoutineActivity["phase"] = "running";
  if (
    part.state === "output-denied" ||
    (part.state === "approval-responded" && !part.approval.approved)
  ) {
    phase = "skipped";
  } else if (part.state === "output-available") {
    phase = "unavailable";
  }
  const activity: RoutineActivity = {
    category: operation.category,
    context: [],
    id: part.toolCallId,
    kind: "operation",
    phase,
    sources: [],
    title:
      part.state === "output-available" ? operation.subject : operation.pending,
  };
  if (activity.phase === "skipped") {
    activity.title = `${operation.subject} skipped`;
    return activity;
  }
  if (part.state !== "output-available") {
    return activity;
  }
  switch (name) {
    case "search_gmail": {
      const result = gmailSearchResultSchema.options[0].safeParse(part.output);
      if (result.success) {
        activity.phase = "complete";
        activity.title =
          result.data.messages.length === 0
            ? "No matching emails"
            : `Found ${result.data.messages.length} ${result.data.messages.length === 1 ? "email" : "emails"}`;
        activity.context = [
          result.data.query,
          ...(result.data.nextPageToken ? ["More matches are available."] : []),
        ];
        activity.sources = mailSources(result.data.messages);
      }
      break;
    }
    case "read_gmail_thread": {
      const result = gmailThreadResultSchema.options[0].safeParse(part.output);
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        activity.context = [
          ...(result.data.subject ? [result.data.subject] : []),
          ...(result.data.omittedMessageCount > 0
            ? [
                `${result.data.messages.length} recent emails read; earlier emails were not included.`,
              ]
            : []),
          ...(result.data.messages.some((message) => message.bodyTruncated)
            ? ["Some message text was shortened."]
            : []),
        ];
        activity.sources = mailSources(
          result.data.messages.map((message) => ({
            ...message,
            subject: result.data.subject,
            threadId: result.data.threadId,
          }))
        );
      }
      break;
    }
    case "read_gmail_message": {
      const result = gmailMessageResultSchema.options[0].safeParse(part.output);
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        activity.context = result.data.bodyTruncated
          ? ["Some message text was shortened."]
          : [];
        activity.sources = mailSources([result.data]);
      }
      break;
    }
    case "read_gmail_messages": {
      const result = gmailMessagesResultSchema.options[0].safeParse(
        part.output
      );
      if (result.success) {
        activity.phase = "complete";
        activity.title = `Read ${result.data.messages.length} ${result.data.messages.length === 1 ? "email" : "emails"}`;
        activity.sources = mailSources(result.data.messages);
        if (result.data.failed.length > 0) {
          return {
            category: operation.category,
            id: part.toolCallId,
            kind: "failure",
            message: `${result.data.messages.length} ${result.data.messages.length === 1 ? "email was" : "emails were"} read. ${result.data.failed.length} could not be loaded.`,
            sources: activity.sources,
            title: "Some emails could not be read",
          };
        }
        if (result.data.messages.some((message) => message.bodyTruncated)) {
          activity.context.push("Some message text was shortened.");
        }
      }
      break;
    }
    case "read_gmail_attachment": {
      const result = gmailAttachmentResultSchema.options[0].safeParse(
        part.output
      );
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        activity.context = [
          result.data.fileName,
          ...(result.data.contentTruncated
            ? ["Some attachment text was shortened."]
            : []),
        ];
      }
      break;
    }
    case "modify_mail": {
      const result = modifyMailResultSchema.options[0].safeParse(part.output);
      if (result.success) {
        activity.phase = "complete";
        activity.title = {
          archive: "Archived your mail",
          mark_read: "Marked your mail as read",
          mark_unread: "Marked your mail as unread",
          star: "Starred your mail",
          trash: "Moved your mail to trash",
          unstar: "Removed the star",
          untrash: "Restored your mail",
        }[result.data.action];
      }
      break;
    }
    case "get_mailbox_overview": {
      const result = mailboxOverviewResultSchema.options[0].safeParse(
        part.output
      );
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        if (result.data.unreadMessages !== undefined) {
          activity.context = [
            `About ${result.data.unreadMessages} unread emails`,
          ];
        }
      }
      break;
    }
    case "list_gmail_labels": {
      const result = gmailLabelListResultSchema.options[0].safeParse(
        part.output
      );
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        activity.context = [
          result.data.labels.map((label) => label.name).join(", "),
        ];
      }
      break;
    }
    case "list_calendars": {
      const result = calendarListToolResultSchema.safeParse(part.output);
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        activity.context = result.data.calendars.map(
          (calendar) => calendar.name
        );
      }
      break;
    }
    case "list_calendar_events": {
      const result = calendarEventsToolResultSchema.safeParse(part.output);
      if (result.success) {
        activity.phase = "complete";
        activity.title =
          result.data.events.length === 0
            ? "No events in that time"
            : `Found ${result.data.events.length} ${result.data.events.length === 1 ? "event" : "events"}`;
        activity.context = result.data.events.map(
          (event) => `${event.title}, ${formatActivityTime(event.time)}`
        );
      }
      break;
    }
    case "get_calendar_event": {
      const result = calendarEventToolResultSchema.safeParse(part.output);
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        activity.context = [
          result.data.event.title,
          formatActivityTime(result.data.event.time),
        ];
      }
      break;
    }
    case "create_calendar_event":
    case "update_calendar_event":
    case "delete_calendar_event":
    case "respond_to_calendar_event": {
      const result = calendarMutationResultSchema.safeParse(part.output);
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        const { event } = result.data;
        activity.context = event
          ? [event.title, formatActivityTime(event.time)]
          : [];
      }
      break;
    }
    case "open_inline_compose": {
      const result = openInlineComposeOutputSchema.safeParse(part.output);
      const command = openInlineComposeInputSchema.safeParse(part.input);
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        activity.context = command.success
          ? [
              {
                forward: "Forward",
                reply: "Reply",
                "reply-all": "Reply all",
              }[command.data.action],
            ]
          : [];
      }
      break;
    }
    case "open_compose":
    case "edit_compose": {
      const result = (
        name === "open_compose"
          ? openComposeOutputSchema
          : editComposeOutputSchema
      ).safeParse(part.output);
      const command = (
        name === "open_compose"
          ? openComposeInputSchema
          : editComposeInputSchema
      ).safeParse(part.input);
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        activity.context = command.success
          ? [command.data.to, command.data.subject].filter(
              (value): value is string =>
                typeof value === "string" && value !== ""
            )
          : [];
      }
      break;
    }
    case "save_compose_draft":
    case "send_mail": {
      const result = (
        name === "send_mail"
          ? sendMailOutputSchema
          : saveComposeDraftOutputSchema
      ).safeParse(part.output);
      const command = saveComposeDraftInputSchema.safeParse(part.input);
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
        activity.context = command.success
          ? [command.data.draft.to, command.data.draft.subject].filter(
              (value): value is string =>
                typeof value === "string" && value !== ""
            )
          : [];
      }
      break;
    }
    case "get_workspace":
    case "navigate":
    case "navigate_calendar": {
      const result = getWorkspaceOutputSchema.safeParse(part.output);
      if (result.success) {
        activity.phase = "complete";
        activity.title = operation.complete;
      }
      break;
    }
    default: {
      if (
        typeof part.output === "object" &&
        part.output !== null &&
        "status" in part.output &&
        part.output.status === "success"
      ) {
        activity.phase = "complete";
        activity.title = operation.complete;
      }
    }
  }
  return activity;
};

export const getChatActivitySegments = ({
  parts,
  approvals,
}: {
  parts: UIMessage["parts"];
  approvals: ChatToolApproval[];
}): ChatActivitySegment[] => {
  const approvalsByCall = new Map(
    approvals.map((approval) => [approval.toolCallId, approval])
  );
  const segments: ChatActivitySegment[] = [];
  for (const [index, part] of parts.entries()) {
    if (part.type === "text" && part.text.trim() !== "") {
      segments.push({ id: `text:${index}`, kind: "text", text: part.text });
    } else if (isChatToolPart(part)) {
      const activity = describeActivity(
        part,
        approvalsByCall.get(part.toolCallId)
      );
      const previous = segments.at(-1);
      if (activity.kind === "operation") {
        if (previous?.kind === "activity") {
          previous.steps.push(activity);
        } else {
          segments.push({
            id: activity.id,
            kind: "activity",
            steps: [activity],
          });
        }
      } else {
        segments.push(activity);
      }
    }
  }
  return segments;
};
