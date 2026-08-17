import {
  Archive01Icon,
  Attachment01Icon,
  Brain01Icon,
  Calendar01Icon,
  Comment01Icon,
  Delete02Icon,
  Layers01Icon,
  Mail01Icon,
  Mail02Icon,
  MailOpen01Icon,
  Mailbox01Icon,
  PencilEdit01Icon,
  Search01Icon,
  StarIcon,
  StarOffIcon,
  Tag01Icon,
  Undo02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";

export type ToolIcon = typeof Wrench01Icon;

/** Stands in for a step whose tool the transcript does not recognize. */
export const unknownToolIcon: ToolIcon = Wrench01Icon;

/** Marks a run of steps collapsed behind one summary row. */
export const toolGroupIcon: ToolIcon = Layers01Icon;

/** Marks the model's reasoning, live or finished. */
export const reasoningIcon: ToolIcon = Brain01Icon;

const modifyMailIcons: Record<string, ToolIcon> = {
  archive: Archive01Icon,
  mark_read: MailOpen01Icon,
  mark_unread: Mail01Icon,
  star: StarIcon,
  trash: Delete02Icon,
  unstar: StarOffIcon,
  untrash: Undo02Icon,
};

const toolIcons: Record<string, ToolIcon> = {
  compose_email: PencilEdit01Icon,
  create_google_calendar_event: Calendar01Icon,
  get_mailbox_overview: Mailbox01Icon,
  list_gmail_labels: Tag01Icon,
  memory: Brain01Icon,
  read_gmail_attachment: Attachment01Icon,
  read_gmail_message: Mail01Icon,
  read_gmail_messages: Mail02Icon,
  read_gmail_thread: Comment01Icon,
  search_gmail: Search01Icon,
};

/**
 * The icon that identifies a step at a glance. `modify_mail` reads as a different
 * action each time, so it resolves against the action rather than the tool.
 */
export const getToolIcon = (name: string, action?: string): ToolIcon => {
  if (name === "modify_mail" && action !== undefined) {
    return modifyMailIcons[action] ?? Archive01Icon;
  }

  return toolIcons[name] ?? unknownToolIcon;
};
