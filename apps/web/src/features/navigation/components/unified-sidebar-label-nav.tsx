"use client";

import { cn } from "@quieter/ui/cn";
import type { ComponentProps } from "react";

import {
  defaultMailboxColor,
  useUnifiedInboxPreferences,
} from "#/features/mailbox/domain/unified-inbox";
import { mailboxLabelDotClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";

import type { MailSidebar } from "./mail-sidebar";
import { MailboxOrganizer } from "./mailbox-organizer";
import { SidebarLabelNav } from "./sidebar-label-nav";

export const UnifiedSidebarLabelNav = ({
  groups,
  userId,
  onSearch,
  onManageLabels,
  searchQuery,
}: {
  groups: ComponentProps<typeof MailSidebar>["groups"];
  userId: string;
  searchQuery: string;
  onSearch: (query: string) => void;
  onManageLabels: (mailboxId?: string) => void;
}) => {
  const preferences = useUnifiedInboxPreferences(userId);
  const mailboxes = groups
    .flatMap((group) => group.mailboxes)
    .filter(
      (mailbox) =>
        mailbox.provider !== "api" &&
        mailbox.connectionStatus === "connected" &&
        !preferences.excludedIds.includes(mailbox.id)
    );
  return (
    <div className="mt-3 space-y-2">
      {mailboxes.map((mailbox) => (
        <div key={mailbox.id}>
          <div
            className="flex min-w-0 items-center gap-2 px-3 py-1 text-caption text-muted-fg"
            title={mailbox.emailAddress}
          >
            <span
              aria-hidden
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                mailboxLabelDotClassNameByColor[
                  preferences.colors[mailbox.id] ??
                    defaultMailboxColor(mailbox.id)
                ]
              )}
            />
            <span className="truncate">
              {mailbox.displayName?.trim() || mailbox.emailAddress}
            </span>
          </div>
          {mailbox.provider === "managed" && (
            <MailboxOrganizer
              mailboxId={mailbox.id}
              canManage={mailbox.grantRole === "manager"}
              searchQuery={searchQuery}
            />
          )}
          <SidebarLabelNav
            animateEntrance={false}
            canManage={
              mailbox.provider === "gmail" || mailbox.grantRole === "manager"
            }
            mailboxId={mailbox.id}
            mailboxProvider={
              mailbox.provider === "managed" ? "managed" : "gmail"
            }
            onManageLabels={() => {
              onManageLabels(mailbox.id);
            }}
            onSearch={onSearch}
            searchQuery={searchQuery}
          />
        </div>
      ))}
    </div>
  );
};
