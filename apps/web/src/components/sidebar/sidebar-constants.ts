import type { IconSvgElement } from "@hugeicons/react";
import { Delete01Icon, InboxIcon, MailSend02Icon } from "@hugeicons/core-free-icons";
import type { MailboxCategory } from "~/lib/gmail/gmail";

export const SIDEBAR_WIDTH = 224;

export type SidebarMailboxItem = {
  id: MailboxCategory;
  label: string;
  icon: IconSvgElement;
};

export const SIDEBAR_MAILBOX_ITEMS: ReadonlyArray<SidebarMailboxItem> = [
  { id: "inbox", label: "Inbox", icon: InboxIcon },
  { id: "sent", label: "Sent", icon: MailSend02Icon },
  { id: "trash", label: "Trash", icon: Delete01Icon },
];
