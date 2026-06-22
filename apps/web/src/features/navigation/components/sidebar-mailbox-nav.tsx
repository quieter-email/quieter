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
import { cn } from "@quieter/ui";
import { LayoutGroup, m } from "motion/react";
import { useRef, useState } from "react";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { SidebarNavItem } from "~/features/navigation/components/sidebar-nav-item";

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
  animateEntrance ? { opacity: 0, x: -20, filter: "blur(8px)" } : false;

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
}: SidebarMailboxNavProps) => {
  const [shouldAnimateEntrance] = useState(animateEntrance);
  const navRef = useRef<HTMLElement>(null);
  const [hoveredMailbox, setHoveredMailbox] = useState<MailboxCategory | null>(null);
  const [exitingMailbox, setExitingMailbox] = useState<MailboxCategory | null>(null);
  const [hoverEnter, setHoverEnter] = useState(false);
  const [hoverSession, setHoverSession] = useState(0);

  const setHover = (mailbox: MailboxCategory) => {
    setHoverEnter(hoveredMailbox === null);
    if (hoveredMailbox === null) {
      setHoverSession((current) => current + 1);
    }
    setExitingMailbox(null);
    setHoveredMailbox(mailbox);
  };

  const clearHover = () => {
    if (hoveredMailbox !== null) {
      setExitingMailbox(hoveredMailbox);
    }
    setHoverEnter(false);
    setHoveredMailbox(null);
  };

  const clearHoverIfLeavingNav = (nextTarget: EventTarget | null) => {
    if (!nextTarget || !navRef.current?.contains(nextTarget as Node)) {
      clearHover();
    }
  };

  return (
    <LayoutGroup id="mailbox-sidebar">
      <nav ref={navRef} aria-label="Mailboxes" className="flex flex-col" onMouseLeave={clearHover}>
        {(mailboxProvider === "managed" ? MANAGED_MAILBOX_ITEMS : SIDEBAR_MAILBOX_ITEMS).map(
          (item, index) => {
            const isActive = selectedMailbox === item.id;
            const isHovered = hoveredMailbox === item.id;
            const isHoverExiting = exitingMailbox === item.id;

            return (
              <m.div
                key={item.id}
                className="w-full will-change-[transform,opacity,filter]"
                initial={getSidebarEntranceInitial(shouldAnimateEntrance)}
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
                    "text-foreground": isActive || isHovered,
                    "text-muted-foreground": !isActive && !isHovered,
                  })}
                  hover={isHovered}
                  hoverEnter={isHovered && hoverEnter}
                  hoverExiting={isHoverExiting}
                  hoverLayoutId={`mailbox-sidebar-hover-${hoverSession}`}
                  onBlur={(event) => clearHoverIfLeavingNav(event.relatedTarget)}
                  onClick={() => onSelectMailbox(item.id)}
                  onFocus={() => {
                    if (!isActive) setHover(item.id);
                  }}
                  onHoverExitComplete={() => setExitingMailbox(null)}
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
          },
        )}
      </nav>
    </LayoutGroup>
  );
};
