"use client";

import { type DragEndEvent, type DragStartEvent, DragDropProvider } from "@dnd-kit/react";
import { isSortableOperation, useSortable } from "@dnd-kit/react/sortable";
import { ArrowDown01Icon, ArrowRight01Icon, PinIcon, PinOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@quieter/ui";
import { type ReactNode, useState } from "react";

type MailboxSwitcherMailbox = {
  displayName: string | null;
  emailAddress: string;
  groupName: string;
  id: string;
  provider: string;
};

type MailboxSwitcherGroup = {
  id: string;
  kind: "personal" | "team";
  mailboxes: MailboxSwitcherMailbox[];
  name: string;
};

export type MailboxSwitcherOrder = {
  groupIds: string[];
  mailboxIdsByGroupId: Record<string, string[]>;
};

type MailboxSummaryProps = {
  action?: ReactNode;
  className?: string;
  mailbox: MailboxSwitcherMailbox;
};

type MailboxSwitcherDropdownProps = {
  defaultMailboxId: string | null;
  groups: MailboxSwitcherGroup[];
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  selectedMailboxId: string | null;
};

type SortableGroupProps = {
  children: ReactNode;
  collapsed: boolean;
  disabled: boolean;
  group: MailboxSwitcherGroup;
  index: number;
  onToggle: (groupId: string) => void;
};

type SortableMailboxRowProps = {
  children: ReactNode;
  disabled: boolean;
  groupId: string;
  index: number;
  mailbox: MailboxSwitcherMailbox;
};

const GROUP_SORTABLE_TYPE = "mailbox-switcher-group";
const getGroupSortableId = (groupId: string) => `group:${groupId}`;
const getMailboxSortableId = (groupId: string, mailboxId: string) =>
  `mailbox:${groupId}:${mailboxId}`;
const getMailboxSortableType = (groupId: string) => `mailbox-switcher-mailbox:${groupId}`;

const moveItem = <TValue,>(items: TValue[], fromIndex: number, toIndex: number) => {
  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);

  if (item === undefined) {
    return items;
  }

  nextItems.splice(toIndex, 0, item);
  return nextItems;
};

const getMailboxSwitcherOrder = (groups: MailboxSwitcherGroup[]): MailboxSwitcherOrder => ({
  groupIds: groups.map((group) => group.id),
  mailboxIdsByGroupId: Object.fromEntries(
    groups.map((group) => [group.id, group.mailboxes.map((mailbox) => mailbox.id)]),
  ),
});

const MailboxSummary = ({ action, className, mailbox }: MailboxSummaryProps) => (
  <div className={cn("flex min-w-0 items-center justify-between gap-3 rounded-md", className)}>
    <p className="truncate text-sm text-foreground">{mailbox.emailAddress}</p>
    {action}
  </div>
);

const SortableGroup = ({
  children,
  collapsed,
  disabled,
  group,
  index,
  onToggle,
}: SortableGroupProps) => {
  const { isDragSource, sourceRef, targetRef } = useSortable({
    accept: GROUP_SORTABLE_TYPE,
    disabled,
    id: getGroupSortableId(group.id),
    index,
    type: GROUP_SORTABLE_TYPE,
  });

  return (
    <section
      className={cn("space-y-1", {
        "opacity-70": isDragSource,
      })}
      ref={targetRef}
    >
      <button
        aria-expanded={!collapsed}
        className={cn(
          "squircle flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-xs px-2 py-1 text-left transition-colors hover:bg-muted/40",
          {
            "cursor-grab active:cursor-grabbing": !disabled,
          },
        )}
        onClick={() => onToggle(group.id)}
        ref={sourceRef}
        type="button"
      >
        <HugeiconsIcon
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground/70"
          icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{group.name}</span>
      </button>
      {!collapsed && children}
    </section>
  );
};

const SortableMailboxRow = ({
  children,
  disabled,
  groupId,
  index,
  mailbox,
}: SortableMailboxRowProps) => {
  const mailboxSortableType = getMailboxSortableType(groupId);
  const { isDragSource, ref } = useSortable({
    accept: mailboxSortableType,
    disabled,
    group: groupId,
    id: getMailboxSortableId(groupId, mailbox.id),
    index,
    type: mailboxSortableType,
  });

  return (
    <div
      className={cn("rounded-xs", {
        "cursor-grab active:cursor-grabbing": !disabled,
        "opacity-70": isDragSource,
      })}
      ref={ref}
    >
      {children}
    </div>
  );
};

export const MailboxSwitcherDropdown = ({
  defaultMailboxId,
  groups,
  onReorderMailboxSwitcher,
  onSelectMailboxId,
  onSetDefaultMailbox,
  selectedMailboxId,
}: MailboxSwitcherDropdownProps) => {
  const mailboxes = groups.flatMap((group) => group.mailboxes);
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? mailboxes[0] ?? null;
  const primaryLabel = selectedMailbox?.emailAddress ?? "no mailbox";
  const secondaryLabel = selectedMailbox?.groupName ?? "No team";
  const canReorderGroups = groups.filter((group) => group.kind === "team").length > 1;
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isReorderingGroups, setIsReorderingGroups] = useState(false);
  const toggleGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };
  const handleDragStart = (event: DragStartEvent) => {
    const { source } = event.operation;
    if (source?.type === GROUP_SORTABLE_TYPE) {
      setIsReorderingGroups(true);
    }
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setIsReorderingGroups(false);

    if (event.canceled || !isSortableOperation(event.operation)) {
      return;
    }

    const { source, target } = event.operation;
    if (!source || !target || source.id === target.id) {
      return;
    }

    if (source.type === GROUP_SORTABLE_TYPE && target.type === GROUP_SORTABLE_TYPE) {
      onReorderMailboxSwitcher(
        getMailboxSwitcherOrder(moveItem(groups, source.index, target.index)),
      );
      return;
    }

    if (
      source.group !== target.group ||
      source.type !== target.type ||
      typeof source.group !== "string"
    ) {
      return;
    }

    const nextGroups = groups.map((group) =>
      group.id === source.group
        ? {
            ...group,
            mailboxes: moveItem(group.mailboxes, source.index, target.index),
          }
        : group,
    );

    onReorderMailboxSwitcher(getMailboxSwitcherOrder(nextGroups));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch mailbox"
        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="min-w-0">
          <p className="truncate text-[13px] leading-5 font-medium tracking-tight text-foreground">
            {primaryLabel}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{secondaryLabel}</p>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-80" side="right" sideOffset={10}>
        <DragDropProvider onDragEnd={handleDragEnd} onDragStart={handleDragStart}>
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto p-1">
            {mailboxes.length > 0 ? (
              groups.map((group, groupIndex) => {
                const isCollapsed = isReorderingGroups || collapsedGroupIds.has(group.id);
                const canReorderMailboxes = group.mailboxes.length > 1;

                return (
                  <SortableGroup
                    collapsed={isCollapsed}
                    disabled={!canReorderGroups}
                    group={group}
                    index={groupIndex}
                    key={group.id}
                    onToggle={toggleGroup}
                  >
                    {group.mailboxes.length > 0 ? (
                      group.mailboxes.map((mailbox, mailboxIndex) => {
                        const isActive = mailbox.id === selectedMailboxId;
                        const isDefault = mailbox.id === defaultMailboxId;

                        return (
                          <SortableMailboxRow
                            disabled={!canReorderMailboxes}
                            groupId={group.id}
                            index={mailboxIndex}
                            key={mailbox.id}
                            mailbox={mailbox}
                          >
                            <DropdownMenuItem
                              className={cn("group/item rounded-xs px-2", {
                                "bg-muted/70": isActive,
                              })}
                              onSelect={() => onSelectMailboxId(mailbox.id)}
                            >
                              <MailboxSummary
                                action={
                                  <button
                                    aria-label={
                                      isDefault ? "Unset default mailbox" : "Set as default mailbox"
                                    }
                                    className={cn(
                                      "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
                                      {
                                        "text-foreground": isDefault,
                                        "text-muted-foreground/50 opacity-0 group-hover/item:opacity-100 hover:text-foreground":
                                          !isDefault,
                                      },
                                    )}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onSetDefaultMailbox(isDefault ? null : mailbox.id);
                                    }}
                                    type="button"
                                  >
                                    <HugeiconsIcon
                                      aria-hidden
                                      className="size-3.5"
                                      icon={isDefault ? PinIcon : PinOffIcon}
                                    />
                                  </button>
                                }
                                className="w-full"
                                mailbox={mailbox}
                              />
                            </DropdownMenuItem>
                          </SortableMailboxRow>
                        );
                      })
                    ) : (
                      <p className="px-2 py-1 text-sm text-muted-foreground">no mailbox</p>
                    )}
                  </SortableGroup>
                );
              })
            ) : (
              <div className="rounded-md px-2.5 py-2 text-sm text-muted-foreground">no mailbox</div>
            )}
          </div>
        </DragDropProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const MailboxSettingsRow = ({ action, className, mailbox }: MailboxSummaryProps) => (
  <div className={cn("flex items-center justify-between gap-3 py-3", className)}>
    <MailboxSummary className="min-w-0 flex-1" mailbox={mailbox} />
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
