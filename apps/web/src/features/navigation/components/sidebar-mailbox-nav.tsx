"use client";

import {
  Archive02Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Mail01Icon,
  MailSend02Icon,
  News01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";

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
  brief?: {
    active: boolean;
    onSelect: () => void;
  };
  mailboxProvider: "api" | "gmail" | "managed" | null;
  selectedMailbox: MailboxCategory | null;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
};

export const SidebarMailboxNav = ({
  animateEntrance,
  brief,
  mailboxProvider,
  onSelectMailbox,
  selectedMailbox,
}: SidebarMailboxNavProps) => {
  const mailboxItems =
    mailboxProvider === "api" ? API_MAILBOX_ITEMS : SIDEBAR_MAILBOX_ITEMS;
  const items = brief
    ? [
        { icon: News01Icon, id: "daily-brief" as const, label: "Brief" },
        ...mailboxItems,
      ]
    : mailboxItems;

  return (
    <nav aria-label="Mailboxes" className="flex flex-col">
      {items.map((item, index) => {
        const isActive =
          item.id === "daily-brief"
            ? brief?.active === true
            : selectedMailbox === item.id;

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
              // oxlint-disable shadcn/no-restyle -- SidebarNavItem owns an animated surface with custom row spacing.
              className="justify-start gap-3 px-3 text-left"
              // oxlint-enable shadcn/no-restyle
              onClick={() => {
                if (item.id === "daily-brief") {
                  brief?.onSelect();
                } else {
                  onSelectMailbox(item.id);
                }
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
};
