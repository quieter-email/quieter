"use client";

import {
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Mail01Icon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { Button, cn } from "@quieter/ui";
import { m } from "motion/react";
import type { MailboxCategory } from "~/lib/gmail/gmail";

const SIDEBAR_MAILBOX_ITEMS: ReadonlyArray<{
  id: MailboxCategory;
  icon: IconSvgElement;
  label: string;
}> = [
  { id: "inbox", label: "Inbox", icon: InboxIcon },
  { id: "unread", label: "Unread", icon: Mail01Icon },
  { id: "sent", label: "Sent", icon: MailSend02Icon },
  { id: "drafts", label: "Drafts", icon: Edit01Icon },
  { id: "trash", label: "Trash", icon: Delete01Icon },
  { id: "spam", label: "Spam", icon: Delete02Icon },
];
const MANAGED_MAILBOX_ITEMS = SIDEBAR_MAILBOX_ITEMS.filter(
  (item) => item.id === "inbox" || item.id === "sent",
);

const getSidebarEntranceDelay = (step: number) => step * 0.1;
const getSidebarEntranceInitial = (animateEntrance: boolean) =>
  animateEntrance ? { opacity: 0, x: -20, filter: "blur(20px)" } : false;

type SidebarMailboxNavProps = {
  animateEntrance: boolean;
  mailboxProvider: "gmail" | "managed" | null;
  selectedMailbox: MailboxCategory;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
};

export const SidebarMailboxNav = ({
  animateEntrance,
  mailboxProvider,
  onSelectMailbox,
  selectedMailbox,
}: SidebarMailboxNavProps) => (
  <nav aria-label="Mailboxes" className="flex flex-col gap-0.5">
    {(mailboxProvider === "managed" ? MANAGED_MAILBOX_ITEMS : SIDEBAR_MAILBOX_ITEMS).map(
      (item, index) => {
        const isActive = selectedMailbox === item.id;

        return (
          <m.div
            key={item.id}
            className="w-full will-change-[transform,opacity,filter]"
            initial={getSidebarEntranceInitial(animateEntrance)}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{
              delay: getSidebarEntranceDelay(index + 2),
              duration: 0.5,
              ease: "easeOut",
            }}
          >
            <Button
              aria-current={isActive ? "page" : undefined}
              className={cn("w-full justify-start gap-3 px-3 text-left text-foreground", {
                "bg-muted hover:bg-muted": isActive,
              })}
              onClick={() => onSelectMailbox(item.id)}
              type="button"
              size="sm"
              variant="ghost"
            >
              <HugeiconsIcon
                strokeWidth={1.5}
                className="shrink-0 text-foreground"
                icon={item.icon}
              />
              {item.label}
            </Button>
          </m.div>
        );
      },
    )}
  </nav>
);
