"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn } from "@quietr/ui";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { SIDEBAR_MAILBOX_ITEMS } from "./sidebar-constants";

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
            isActive
              ? "bg-secondary text-foreground shadow-sm hover:bg-secondary active:bg-secondary"
              : "text-foreground-light hover:bg-secondary/50 hover:text-foreground active:bg-secondary/80",
          )}
          key={item.id}
          onClick={() => onSelectMailbox(item.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon
            className={cn("size-4 shrink-0", {
              "stroke-[2.2] text-foreground": isActive,
              "stroke-[1.9] text-foreground-light": !isActive,
            })}
            icon={item.icon}
          />
          <span>{item.label}</span>
        </Button>
      );
    })}
  </nav>
);
