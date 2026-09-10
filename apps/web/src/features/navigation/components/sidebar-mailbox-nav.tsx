"use client";

import {
  Archive02Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Mail01Icon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";

import { SidebarNavItem } from "#/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "#/features/navigation/components/sidebar-surfaces";
import type { MailboxCategory } from "#/lib/mail";

const SIDEBAR_MAILBOX_ITEMS: readonly {
  id: MailboxCategory;
  icon: IconSvgElement;
  label: string;
}[] = [
  { icon: InboxIcon, id: "inbox", label: "Inbox" },
  { icon: Mail01Icon, id: "unread", label: "Unread" },
  { icon: Archive02Icon, id: "archive", label: "Archive" },
  { icon: MailSend02Icon, id: "sent", label: "Sent" },
  { icon: Edit01Icon, id: "drafts", label: "Drafts" },
  { icon: Delete01Icon, id: "trash", label: "Trash" },
  { icon: Delete02Icon, id: "spam", label: "Spam" },
];
const API_MAILBOX_ITEMS = SIDEBAR_MAILBOX_ITEMS.filter(
  (item) => item.id === "sent"
);

type SidebarMailboxNavProps = {
  animateEntrance: boolean;
  mailboxProvider: "api" | "gmail" | "managed" | null;
  selectedMailbox: MailboxCategory | null;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
};

export const SidebarMailboxNav = ({
  animateEntrance,
  mailboxProvider,
  onSelectMailbox,
  selectedMailbox,
}: SidebarMailboxNavProps) => (
  <nav aria-label="Mailboxes" className="flex flex-col">
    {(mailboxProvider === "api"
      ? API_MAILBOX_ITEMS
      : SIDEBAR_MAILBOX_ITEMS
    ).map((item, index) => {
      const isActive = selectedMailbox === item.id;

      return (
        <SidebarEntrance
          key={item.id}
          animateEntrance={animateEntrance}
          className="w-full"
          index={index + 3}
        >
          <SidebarNavItem
            active={isActive}
            aria-current={isActive ? "page" : undefined}
            className={cn("w-full justify-start gap-3 px-3 text-left", {
              "text-fg": isActive,
              "text-muted-fg": !isActive,
            })}
            onClick={() => {
              onSelectMailbox(item.id);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon
              strokeWidth={1.5}
              className="shrink-0 text-fg"
              icon={item.icon}
            />
            {item.label}
          </SidebarNavItem>
        </SidebarEntrance>
      );
    })}
  </nav>
);
