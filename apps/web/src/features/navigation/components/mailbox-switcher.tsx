"use client";

import { Modifier } from "@dnd-kit/abstract";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { type DragEndEvent, DragDropProvider } from "@dnd-kit/react";
import { isSortableOperation, useSortable } from "@dnd-kit/react/sortable";
import { ArrowDown01Icon, ArrowRight01Icon, PinIcon, PinOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@quieter/ui";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import { VerticalSlot } from "~/components/vertical-slot";

type MailboxSwitcherMailbox = {
  connectionStatus: "connected" | "needs_reconnect";
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
  side?: "bottom" | "right";
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

type MailboxRowsProps = {
  children: (mailbox: MailboxSwitcherMailbox, mailboxIndex: number) => ReactNode;
  group: MailboxSwitcherGroup;
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  groups: MailboxSwitcherGroup[];
};

const GROUP_DRAG_SENSORS = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
];

class RestrictToVerticalAxis extends Modifier {
  override apply({ transform }: Parameters<Modifier["apply"]>[0]) {
    return { x: 0, y: transform.y };
  }
}

const VERTICAL_AXIS_MODIFIERS = [RestrictToVerticalAxis];

const GROUP_SORTABLE_TYPE = "mailbox-switcher-group";
const GROUP_SORTABLE_ID_PREFIX = "group:";
const getGroupSortableId = (groupId: string) => `${GROUP_SORTABLE_ID_PREFIX}${groupId}`;
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
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm text-foreground">{mailbox.emailAddress}</p>
      {mailbox.connectionStatus === "needs_reconnect" && (
        <p className="mt-0.5 truncate text-xs text-destructive">
          This account needs to reconnect through Google.
        </p>
      )}
    </div>
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
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const { isDragSource } = useSortable({
    accept: GROUP_SORTABLE_TYPE,
    disabled,
    element: sectionRef,
    handle: headerRef,
    id: getGroupSortableId(group.id),
    index,
    modifiers: VERTICAL_AXIS_MODIFIERS,
    sensors: GROUP_DRAG_SENSORS,
    target: sectionRef,
    transition: null,
    type: GROUP_SORTABLE_TYPE,
  });

  return (
    <LazyMotion features={domAnimation}>
      <m.section
        className={cn("will-change-[height,opacity]", {
          "opacity-70": isDragSource,
        })}
        ref={sectionRef}
      >
        <button
          aria-expanded={!collapsed}
          className={cn(
            "squircle flex min-h-7 w-full items-center gap-2 rounded-xs px-2 py-1 text-left transition-colors hover:bg-muted/40",
          )}
          onClick={() => onToggle(group.id)}
          ref={headerRef}
          type="button"
        >
          <HugeiconsIcon
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground/70"
            icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon}
          />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {group.name}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden will-change-[height,opacity]"
            >
              <div className="space-y-1 pt-1">{children}</div>
            </m.div>
          )}
        </AnimatePresence>
      </m.section>
    </LazyMotion>
  );
};

const MailboxRows = ({ children, group, groups, onReorderMailboxSwitcher }: MailboxRowsProps) => {
  const handleMailboxDragEnd = (event: DragEndEvent) => {
    if (event.canceled || !isSortableOperation(event.operation)) {
      return;
    }

    const { source, target } = event.operation;
    if (
      !source ||
      !target ||
      source.initialIndex === source.index ||
      source.initialGroup !== group.id ||
      source.group !== group.id ||
      source.type !== target.type
    ) {
      return;
    }

    const nextGroups = groups.map((candidate) =>
      candidate.id === group.id
        ? {
            ...candidate,
            mailboxes: moveItem(candidate.mailboxes, source.initialIndex, source.index),
          }
        : candidate,
    );

    onReorderMailboxSwitcher(getMailboxSwitcherOrder(nextGroups));
  };

  return (
    <DragDropProvider onDragEnd={handleMailboxDragEnd}>
      {group.mailboxes.map((mailbox, mailboxIndex) => children(mailbox, mailboxIndex))}
    </DragDropProvider>
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
    modifiers: VERTICAL_AXIS_MODIFIERS,
    type: mailboxSortableType,
  });

  return (
    <div
      className={cn("rounded-xs", {
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
  side = "right",
}: MailboxSwitcherDropdownProps) => {
  const mailboxes = groups.flatMap((group) => group.mailboxes);
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? mailboxes[0] ?? null;
  const primaryLabel = selectedMailbox?.emailAddress ?? "no mailbox";
  const secondaryLabel = selectedMailbox?.groupName ?? "No team";
  const canReorderGroups = groups.length > 1;
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(() => new Set());
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
  const handleGroupDragEnd = (event: DragEndEvent) => {
    if (event.canceled || !isSortableOperation(event.operation)) {
      return;
    }

    const { source, target } = event.operation;
    if (!source || !target || source.initialIndex === source.index) {
      return;
    }

    if (source.type !== GROUP_SORTABLE_TYPE || target.type !== GROUP_SORTABLE_TYPE) {
      return;
    }

    onReorderMailboxSwitcher(
      getMailboxSwitcherOrder(moveItem(groups, source.initialIndex, source.index)),
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch mailbox"
        className="squircle w-full min-w-0 flex-1 rounded-md px-4 py-3 text-left outline-none hover:bg-secondary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-100"
      >
        <VerticalSlot className="min-w-0">
          <div>
            <p className="truncate text-[13px]/5 font-medium tracking-tight text-foreground">
              {primaryLabel}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{secondaryLabel}</p>
          </div>
        </VerticalSlot>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))]"
        side={side}
        sideOffset={10}
      >
        <DragDropProvider onDragEnd={handleGroupDragEnd}>
          <div className="flex max-h-96 flex-col gap-1 overflow-y-auto p-1">
            {mailboxes.length > 0 ? (
              groups.map((group, groupIndex) => {
                const isCollapsed = collapsedGroupIds.has(group.id);
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
                      <MailboxRows
                        group={group}
                        groups={groups}
                        onReorderMailboxSwitcher={onReorderMailboxSwitcher}
                      >
                        {(mailbox, mailboxIndex) => {
                          const isActive = mailbox.id === selectedMailboxId;
                          const isDefault = mailbox.id === defaultMailboxId;
                          const defaultMailboxLabel = isDefault
                            ? "Unset default mailbox"
                            : "Set as default mailbox";

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
                                    <Tooltip>
                                      <TooltipTrigger className="inline-flex" render={<span />}>
                                        <button
                                          aria-label={defaultMailboxLabel}
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
                                      </TooltipTrigger>
                                      <TooltipContent className="px-2 py-1">
                                        {defaultMailboxLabel}
                                        <TooltipArrow />
                                      </TooltipContent>
                                    </Tooltip>
                                  }
                                  className="w-full"
                                  mailbox={mailbox}
                                />
                              </DropdownMenuItem>
                            </SortableMailboxRow>
                          );
                        }}
                      </MailboxRows>
                    ) : (
                      <p className="px-2 py-1 text-sm text-muted-foreground">No Mailbox</p>
                    )}
                  </SortableGroup>
                );
              })
            ) : (
              <div className="rounded-md px-2.5 py-2 text-sm text-muted-foreground">No Mailbox</div>
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
