"use client";

import {
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Button, cn } from "@quieter/ui";
import type { MailboxCategory } from "~/lib/gmail/gmail";

const SIDEBAR_MAILBOX_ITEMS: ReadonlyArray<{
  id: MailboxCategory;
  icon: IconSvgElement;
  label: string;
}> = [
  { id: "inbox", label: "Inbox", icon: InboxIcon },
  { id: "sent", label: "Sent", icon: MailSend02Icon },
  { id: "drafts", label: "Drafts", icon: Edit01Icon },
  { id: "trash", label: "Trash", icon: Delete01Icon },
  { id: "spam", label: "Spam", icon: Delete02Icon },
];

type SidebarMailboxNavProps = {
  selectedMailbox: MailboxCategory;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
};

export const SidebarMailboxNav = ({ onSelectMailbox, selectedMailbox }: SidebarMailboxNavProps) => (
  <nav aria-label="Mailboxes" className="flex flex-col gap-1.5">
    {SIDEBAR_MAILBOX_ITEMS.map((item) => {
      const isActive = selectedMailbox === item.id;

      return (
        <Button
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "group relative h-9 w-full justify-start gap-3 rounded-md px-3 text-left text-sm font-medium",
            {
              "bg-secondary text-secondary-foreground hover:bg-secondary active:bg-secondary":
                isActive,
            },
          )}
          key={item.id}
          onClick={() => onSelectMailbox(item.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon
            strokeWidth={isActive ? 2.5 : 1.5}
            className={cn("size-4 shrink-0", {
              "text-foreground": isActive,
              "text-foreground-light": !isActive,
            })}
            icon={item.icon}
          />
          <span>{item.label}</span>
        </Button>
      );
    })}
  </nav>
);
