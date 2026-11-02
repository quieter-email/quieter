"use client";

import {
  Archive02Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Mail01Icon,
  MailSend02Icon,
  Flag01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { SidebarMailboxNavItem } from "@quieter/app/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "@quieter/app/features/navigation/components/sidebar-surfaces";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { Icon } from "@quieter/ui/icon";

const SIDEBAR_MAILBOX_ITEMS: readonly {
  id: MailboxCategory;
  icon: IconSvgElement;
  label: string;
}[] = [
  { icon: Flag01Icon, id: "important", label: "Important" },
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
  allInboxesActive: boolean;
  animateEntrance: boolean;
  embedded: boolean;
  mailboxId: string | null;
  mailboxProvider: "api" | "gmail" | "managed" | null;
  onRequestClose?: () => void;
  selectedMailbox: MailboxCategory | null;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
};

export const SidebarMailboxNav = ({
  allInboxesActive,
  animateEntrance,
  embedded,
  mailboxId,
  mailboxProvider,
  onRequestClose,
  onSelectMailbox,
  selectedMailbox,
}: SidebarMailboxNavProps) => {
  const mailboxItems =
    mailboxProvider === "api" ? API_MAILBOX_ITEMS : SIDEBAR_MAILBOX_ITEMS;

  return (
    <nav aria-label="Mailboxes" className="flex flex-col">
      <SidebarEntrance
        animateEntrance={animateEntrance}
        className="mt-2 mb-1 flex items-center justify-between px-2"
        index={3}
      >
        <p className="text-caption font-medium text-muted-fg">Mail</p>
      </SidebarEntrance>
      {mailboxItems.map((item, index) => {
        const isActive = selectedMailbox === item.id;

        return (
          <SidebarEntrance
            key={item.id}
            animateEntrance={animateEntrance}
            className="w-full"
            index={index + 3}
          >
            <SidebarMailboxNavItem
              active={isActive}
              aria-current={isActive ? "page" : undefined}
              // oxlint-disable shadcn/no-restyle -- SidebarNavItem owns an animated surface with custom row spacing.
              className="justify-start gap-3 px-3 text-left"
              // oxlint-enable shadcn/no-restyle
              mailboxSearch={
                embedded
                  ? undefined
                  : {
                      mailbox: item.id,
                      mailboxId,
                      messageId: null,
                      view: allInboxesActive ? "all-inboxes" : "inbox",
                      workspace: null,
                    }
              }
              onClick={() => {
                if (embedded) {
                  onSelectMailbox(item.id);
                }
                onRequestClose?.();
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Icon tone="default" icon={item.icon} />
              {item.label}
            </SidebarMailboxNavItem>
          </SidebarEntrance>
        );
      })}
    </nav>
  );
};
