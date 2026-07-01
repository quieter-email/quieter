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
import { cn } from "@quieter/ui/cn";
import { LayoutGroup, m } from "motion/react";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { SidebarNavItem } from "~/features/navigation/components/sidebar-nav-item";
import { useSidebarNavHover } from "~/features/navigation/hooks/use-sidebar-nav-hover";

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
const MANAGED_MAILBOX_ITEMS = SIDEBAR_MAILBOX_ITEMS.filter((item) => item.id !== "drafts");
const API_MAILBOX_ITEMS = SIDEBAR_MAILBOX_ITEMS.filter((item) => item.id === "sent");

const getSidebarEntranceDelay = (step: number) => step * 0.1;
const getSidebarEntranceInitial = (animateEntrance: boolean) =>
  animateEntrance ? { opacity: 0, x: -20, filter: "blur(8px)" } : false;

type SidebarMailboxNavProps = {
  animateEntrance: boolean;
  mailboxProvider: "api" | "gmail" | "managed" | null;
  selectedMailbox: MailboxCategory;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
};

export const SidebarMailboxNav = ({
  animateEntrance,
  mailboxProvider,
  onSelectMailbox,
  selectedMailbox,
}: SidebarMailboxNavProps) => {
  const {
    clearHover,
    clearHoverIfLeavingNav,
    hoverEnter,
    hoverLayoutId,
    isHoverExiting,
    isHovered,
    navRef,
    onHoverExitComplete,
    setHover,
  } = useSidebarNavHover<MailboxCategory>("mailbox-sidebar-hover");

  return (
    <LayoutGroup id="mailbox-sidebar">
      <nav ref={navRef} aria-label="Mailboxes" className="flex flex-col" onMouseLeave={clearHover}>
        {(mailboxProvider === "api"
          ? API_MAILBOX_ITEMS
          : mailboxProvider === "managed"
            ? MANAGED_MAILBOX_ITEMS
            : SIDEBAR_MAILBOX_ITEMS
        ).map((item, index) => {
          const isActive = selectedMailbox === item.id;
          const itemHovered = isHovered(item.id);

          return (
            <m.div
              key={item.id}
              className="w-full will-change-[transform,opacity,filter]"
              initial={getSidebarEntranceInitial(animateEntrance)}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              transition={{
                delay: getSidebarEntranceDelay(index + 3),
                duration: 0.5,
                ease: "easeOut",
              }}
            >
              <SidebarNavItem
                active={isActive}
                aria-current={isActive ? "page" : undefined}
                className={cn("w-full justify-start gap-3 px-3 text-left", {
                  "text-foreground": isActive || itemHovered,
                  "text-muted-foreground": !isActive && !itemHovered,
                })}
                hover={itemHovered}
                hoverEnter={itemHovered && hoverEnter}
                hoverExiting={isHoverExiting(item.id)}
                hoverLayoutId={hoverLayoutId}
                onBlur={(event) => clearHoverIfLeavingNav(event.relatedTarget)}
                onClick={() => onSelectMailbox(item.id)}
                onFocus={() => {
                  if (!isActive) setHover(item.id);
                }}
                onHoverExitComplete={onHoverExitComplete}
                onMouseEnter={() => {
                  if (isActive) {
                    clearHover();
                    return;
                  }
                  setHover(item.id);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon
                  strokeWidth={1.5}
                  className="shrink-0 text-foreground"
                  icon={item.icon}
                />
                {item.label}
              </SidebarNavItem>
            </m.div>
          );
        })}
      </nav>
    </LayoutGroup>
  );
};
