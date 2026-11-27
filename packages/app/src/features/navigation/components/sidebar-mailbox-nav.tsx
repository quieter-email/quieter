"use client";

import {
  AlarmClockIcon,
  CheckmarkCircle02Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Mail01Icon,
  MailSend02Icon,
  Flag01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { ShortcutHint } from "@quieter/app/features/hotkeys/components/shortcut-hint";
import type { KeyboardShortcutId } from "@quieter/app/features/hotkeys/domain/keyboard-shortcuts";
import { SidebarMailboxNavItem } from "@quieter/app/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "@quieter/app/features/navigation/components/sidebar-surfaces";
import type { MailboxCategory } from "@quieter/app/lib/mail";
import { Icon } from "@quieter/ui/icon";

import { useSidebarMailCounts } from "../domain/sidebar-mail-counts";
import { orderSidebarEntries } from "../domain/sidebar-preferences";
import { SidebarContextMenu } from "./sidebar-context-menu";

const SIDEBAR_MAILBOX_ITEMS: readonly {
  id: MailboxCategory;
  icon: IconSvgElement;
  label: string;
  shortcutId?: KeyboardShortcutId;
}[] = [
  {
    icon: Flag01Icon,
    id: "important",
    label: "Important",
    shortcutId: "go-important",
  },
  { icon: InboxIcon, id: "inbox", label: "Inbox", shortcutId: "go-inbox" },
  {
    icon: CheckmarkCircle02Icon,
    id: "done",
    label: "Done",
    shortcutId: "go-done",
  },
  {
    icon: AlarmClockIcon,
    id: "later",
    label: "Later",
    shortcutId: "go-later",
  },
  { icon: Mail01Icon, id: "unread", label: "Unread", shortcutId: "go-unread" },
  { icon: MailSend02Icon, id: "sent", label: "Sent", shortcutId: "go-sent" },
  { icon: Edit01Icon, id: "drafts", label: "Drafts", shortcutId: "go-drafts" },
  { icon: Delete01Icon, id: "trash", label: "Trash", shortcutId: "go-trash" },
  { icon: Delete02Icon, id: "spam", label: "Spam", shortcutId: "go-spam" },
];
export const getSidebarMailItems = (
  mailboxProvider: SidebarMailboxNavProps["mailboxProvider"]
) =>
  mailboxProvider === "api"
    ? SIDEBAR_MAILBOX_ITEMS.filter((item) => item.id === "sent")
    : SIDEBAR_MAILBOX_ITEMS;

type SidebarMailboxNavProps = {
  allInboxesActive: boolean;
  userId: string;
  mailboxes: Parameters<typeof useSidebarMailCounts>[0]["mailboxes"];
  countEntries: readonly string[];
  onSetCounts: (ids: readonly string[], enabled: boolean) => void;
  order?: readonly string[];
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
  userId,
  mailboxes,
  countEntries,
  onSetCounts,
  order,
  animateEntrance,
  embedded,
  mailboxId,
  mailboxProvider,
  onRequestClose,
  onSelectMailbox,
  selectedMailbox,
}: SidebarMailboxNavProps) => {
  const mailboxItems = getSidebarMailItems(mailboxProvider);
  const countableIds =
    !embedded && (mailboxId !== null || allInboxesActive)
      ? mailboxItems.map((item) => item.id)
      : [];
  const enabledCounts = countableIds.filter((id) => countEntries.includes(id));

  const counts = useSidebarMailCounts({
    allInboxesActive,
    entries: enabledCounts,
    mailboxId,
    mailboxes,
    userId,
  });

  return (
    <nav aria-label="Mailboxes" className="flex flex-col">
      <SidebarEntrance
        animateEntrance={animateEntrance}
        className="mt-2 mb-1"
        index={3}
      >
        <SidebarContextMenu
          actions={[
            ...(enabledCounts.length < countableIds.length
              ? [
                  {
                    label: "Show all counts",
                    onSelect: () => {
                      onSetCounts(countableIds, true);
                    },
                  },
                ]
              : []),
            ...(enabledCounts.length > 0
              ? [
                  {
                    label: "Hide all counts",
                    onSelect: () => {
                      onSetCounts(countableIds, false);
                    },
                  },
                ]
              : []),
          ]}
        >
          <p className="px-3 text-caption font-medium text-muted-fg">Mail</p>
        </SidebarContextMenu>
      </SidebarEntrance>
      {orderSidebarEntries(mailboxItems, order).map((item, index) => {
        const showCount = enabledCounts.includes(item.id);
        const count = counts.get(item.id);
        const isActive = selectedMailbox === item.id;

        return (
          <SidebarEntrance
            key={item.id}
            animateEntrance={animateEntrance}
            className="w-full"
            index={index + 3}
          >
            <SidebarContextMenu
              actions={
                countableIds.includes(item.id)
                  ? [
                      {
                        label: showCount ? "Hide count" : "Show count",
                        onSelect: () => {
                          onSetCounts([item.id], !showCount);
                        },
                      },
                    ]
                  : []
              }
            >
              <SidebarMailboxNavItem
                active={isActive}
                aria-current={isActive ? "page" : undefined}
                mailboxSearch={
                  embedded
                    ? undefined
                    : {
                        mailbox: item.id,
                        mailboxId,
                        messageId: null,
                        threadId: null,
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
                type="button"
                variant="ghost"
              >
                <Icon tone="default" icon={item.icon} />
                {item.label}
                {showCount && count !== undefined && (
                  <span
                    className="ml-auto text-micro text-muted-fg tabular-nums"
                    title={`Total in ${item.label}`}
                  >
                    {count > 99 ? "99+" : count}
                  </span>
                )}
                {!showCount &&
                  !embedded &&
                  mailboxId !== null &&
                  item.shortcutId && (
                    <ShortcutHint
                      className="ml-auto"
                      shortcutId={item.shortcutId}
                    />
                  )}
              </SidebarMailboxNavItem>
            </SidebarContextMenu>
          </SidebarEntrance>
        );
      })}
    </nav>
  );
};
