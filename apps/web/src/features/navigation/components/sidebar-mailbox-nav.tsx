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

const getSidebarEntranceDelay = (step: number) => step * 0.1;
const getSidebarEntranceInitial = (animateEntrance: boolean) =>
  animateEntrance ? { opacity: 0, x: -20, filter: "blur(20px)" } : false;

type SidebarMailboxNavProps = {
  animateEntrance: boolean;
  selectedMailbox: MailboxCategory;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
};

export const SidebarMailboxNav = ({
  animateEntrance,
  onSelectMailbox,
  selectedMailbox,
}: SidebarMailboxNavProps) => (
  <nav aria-label="Mailboxes" className="flex flex-col gap-1.5">
    {SIDEBAR_MAILBOX_ITEMS.map((item, index) => {
      const isActive = selectedMailbox === item.id;

      return (
        <m.div
          key={item.id}
          className="w-full will-change-[transform,opacity,filter]"
          initial={getSidebarEntranceInitial(animateEntrance)}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          transition={{ delay: getSidebarEntranceDelay(index + 2), duration: 0.5, ease: "easeOut" }}
        >
          <Button
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group relative w-full justify-start gap-3 rounded-md border border-transparent px-3 text-left text-sm font-medium transition-[font-weight,scale] hover:font-extrabold",
              {
                "border-primary/20 bg-primary/10 font-extrabold text-foreground hover:bg-primary/15":
                  isActive,
                "hover:[&_svg_*]:stroke-3": !isActive,
              },
              "[&_svg_*]:transition-[stroke-width]",
            )}
            onClick={() => onSelectMailbox(item.id)}
            type="button"
            size="sm"
            variant="ghost"
          >
            <HugeiconsIcon
              strokeWidth={isActive ? 3 : 1.5}
              className={cn("size-4 shrink-0", {
                "text-foreground": isActive,
                "text-foreground-light": !isActive,
              })}
              icon={item.icon}
            />
            {item.label}
          </Button>
        </m.div>
      );
    })}
  </nav>
);
