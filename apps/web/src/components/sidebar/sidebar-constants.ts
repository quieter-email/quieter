import { IconInbox, IconSend, IconTrash } from "@tabler/icons-solidjs";
import type { MailboxCategory } from "~/lib/gmail/gmail";

export const SIDEBAR_WIDTH = 224;

export type SidebarMailboxItem = {
  id: MailboxCategory;
  label: string;
  icon: typeof IconInbox;
};

export const SIDEBAR_MAILBOX_ITEMS: ReadonlyArray<SidebarMailboxItem> = [
  { id: "inbox", label: "Inbox", icon: IconInbox },
  { id: "sent", label: "Sent", icon: IconSend },
  { id: "trash", label: "Trash", icon: IconTrash },
];
