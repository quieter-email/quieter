"use client";

import { Modifier } from "@dnd-kit/abstract";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { type DragEndEvent, DragDropProvider } from "@dnd-kit/react";
import { isSortableOperation, useSortable } from "@dnd-kit/react/sortable";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Loading03Icon,
  Mail01Icon,
  PinIcon,
  PinOffIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import { VerticalSlot } from "~/components/vertical-slot";
import { SidebarSimpleHoverSurface } from "~/features/navigation/components/sidebar-surfaces";

type MailboxSwitcherMailbox = {
  connectionStatus: "connected" | "needs_reconnect";
  displayName: string | null;
  divisionName?: string | null;
  emailAddress: string;
  groupName: string;
  id: string;
  provider: string;
  grantRole?: "manager" | "reader" | "responder" | null;
  unreadNonSpamCount: number;
};

type MailboxSwitcherGroup = {
  id: string;
  kind: "division" | "organization" | "unassigned";
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

type MailboxDefaultButtonProps = {
  defaultMailboxLabel: string;
  isDefault: boolean;
  mailboxId: string;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
};

type MailboxSwitcherDropdownProps = {
  defaultMailboxId: string | null;
  embedded?: boolean;
  groups: MailboxSwitcherGroup[];
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onReconnectMailbox: (mailbox: Pick<MailboxSwitcherMailbox, "emailAddress" | "id">) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  reconnectingMailboxId: string | null;
  selectedMailboxId: string | null;
  side?: "bottom" | "right";
};

type SortableGroupProps = {
  children: ReactNode;
  collapsed: boolean;
  disabled: boolean;
  embedded?: boolean;
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

const formatUnreadCount = (count: number) => (count > 99 ? "99+" : String(Math.max(0, count)));

const MailboxUnreadBadge = ({ count }: { count: number }) =>
  count > 0 ? (
    <span
      aria-label={`${count} unread non-spam messages`}
      className="flex h-4 min-w-5 shrink-0 items-center justify-center rounded-[5px] bg-foreground/10 px-1 text-[10px]/4 font-medium text-muted-foreground tabular-nums ring-1 ring-border/70 squircle"
    >
      {formatUnreadCount(count)}
    </span>
  ) : null;

const MailboxSummary = ({ action, className, mailbox }: MailboxSummaryProps) => (
  <div className={cn("flex min-w-0 items-center justify-between gap-3 rounded-md", className)}>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm text-foreground">
        {mailbox.displayName?.trim() || mailbox.emailAddress}
      </p>
      {mailbox.displayName?.trim() && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{mailbox.emailAddress}</p>
      )}
      {mailbox.connectionStatus === "needs_reconnect" && (
        <p className="mt-0.5 truncate text-xs text-destructive">
          This account needs to reconnect through Google.
        </p>
      )}
    </div>
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {action}
      <MailboxUnreadBadge count={mailbox.unreadNonSpamCount} />
    </div>
  </div>
);

const MailboxDefaultButton = ({
  defaultMailboxLabel,
  isDefault,
  mailboxId,
  onSetDefaultMailbox,
}: MailboxDefaultButtonProps) => (
  <IconButtonTooltip label={defaultMailboxLabel}>
    <button
      aria-label={defaultMailboxLabel}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
        {
          "text-foreground": isDefault,
          "text-muted-foreground/50 opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 hover:text-foreground focus-visible:opacity-100":
            !isDefault,
        },
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSetDefaultMailbox(isDefault ? null : mailboxId);
      }}
      type="button"
    >
      <HugeiconsIcon aria-hidden className="size-3.5" icon={isDefault ? PinIcon : PinOffIcon} />
    </button>
  </IconButtonTooltip>
);

const SortableGroup = ({
  children,
  collapsed,
  disabled,
  embedded = false,
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
        <div className="group/header flex min-h-7 items-center rounded-xs transition-colors squircle focus-within:bg-background/50 hover:bg-background/50">
          <button
            aria-expanded={!collapsed}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-xs px-2 py-1 text-left outline-none squircle"
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
          {group.kind === "organization" && !embedded && (
            <IconButtonTooltip label={`Open ${group.name} settings`}>
              <LinkButton
                aria-label={`Open ${group.name} settings`}
                className="pointer-events-none mr-0.5 size-7 opacity-0 transition-opacity group-focus-within/header:pointer-events-auto group-focus-within/header:opacity-100 group-hover/header:pointer-events-auto group-hover/header:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                search={{
                  from: "/",
                  organizationId: group.id,
                  organizationView: "overview",
                  tab: "organization",
                }}
                size="icon-sm"
                to="/settings"
                variant="ghost"
              >
                <HugeiconsIcon aria-hidden icon={Settings01Icon} />
              </LinkButton>
            </IconButtonTooltip>
          )}
        </div>

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
  embedded = false,
  groups,
  onReorderMailboxSwitcher,
  onReconnectMailbox,
  onSelectMailboxId,
  onSetDefaultMailbox,
  reconnectingMailboxId,
  selectedMailboxId,
  side = "right",
}: MailboxSwitcherDropdownProps) => {
  const mailboxes = groups.flatMap((group) => group.mailboxes);
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ?? mailboxes[0] ?? null;
  const primaryLabel =
    selectedMailbox?.displayName?.trim() || selectedMailbox?.emailAddress || "no mailbox";
  const secondaryLabel = selectedMailbox
    ? [
        selectedMailbox.displayName?.trim() ? selectedMailbox.emailAddress : null,
        selectedMailbox.groupName,
        selectedMailbox.grantRole,
      ]
        .filter(Boolean)
        .join(" / ")
    : "No team";
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isTriggerHovered, setIsTriggerHovered] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isFiltering = normalizedSearchQuery.length > 0;
  const canReorderGroups = !isFiltering && groups.length > 1;
  const filteredGroups = groups.reduce<MailboxSwitcherGroup[]>((nextGroups, group) => {
    const matchingMailboxes = group.mailboxes.filter((mailbox) =>
      [
        mailbox.displayName,
        mailbox.emailAddress,
        mailbox.groupName,
        mailbox.divisionName,
        mailbox.grantRole,
        mailbox.provider,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearchQuery)),
    );
    if (matchingMailboxes.length > 0) {
      nextGroups.push({ ...group, mailboxes: matchingMailboxes });
    }
    return nextGroups;
  }, []);
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
      <div
        className="relative min-w-0 flex-1 rounded-md squircle"
        onMouseEnter={() => setIsTriggerHovered(true)}
        onMouseLeave={() => setIsTriggerHovered(false)}
      >
        <SidebarSimpleHoverSurface layoutId="mailbox-switcher-hover" visible={isTriggerHovered} />
        <DropdownMenuTrigger
          aria-label="Switch mailbox"
          className="relative z-10 w-full min-w-0 rounded-md px-3 py-2 text-left outline-none squircle hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-100"
        >
          <VerticalSlot className="min-w-0">
            <div>
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px]/5 font-medium tracking-tight text-foreground">
                  {primaryLabel}
                </p>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{secondaryLabel}</p>
            </div>
          </VerticalSlot>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))]"
        side={side}
        sideOffset={10}
      >
        <DragDropProvider onDragEnd={handleGroupDragEnd}>
          <div className="flex max-h-96 flex-col gap-1 overflow-y-auto p-1">
            {mailboxes.length > 0 ? (
              <>
                <div className="sticky top-0 z-10 bg-popover p-1">
                  <Input
                    aria-label="Search mailboxes"
                    className="h-8"
                    onChange={(event) => setSearchQuery(event.currentTarget.value)}
                    placeholder="Search mailboxes"
                    size="sm"
                    value={searchQuery}
                  />
                </div>
                {(isFiltering ? filteredGroups : groups).map((group, groupIndex) => {
                  const isCollapsed = collapsedGroupIds.has(group.id);
                  const canReorderMailboxes = !isFiltering && group.mailboxes.length > 1;

                  return (
                    <SortableGroup
                      collapsed={isCollapsed}
                      disabled={!canReorderGroups}
                      embedded={embedded}
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
                            const needsReconnect = mailbox.connectionStatus === "needs_reconnect";
                            const isReconnecting = reconnectingMailboxId === mailbox.id;
                            const canSetDefault = mailbox.provider !== "api";
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
                                  className={cn("group/item rounded-xs px-2 py-1 squircle", {
                                    "bg-background": isActive,
                                  })}
                                  onSelect={() => onSelectMailboxId(mailbox.id)}
                                >
                                  {needsReconnect ? (
                                    <div className="flex w-full min-w-0 items-center gap-2">
                                      <p className="min-w-0 flex-1 truncate text-sm text-foreground">
                                        {mailbox.displayName?.trim() || mailbox.emailAddress}
                                      </p>
                                      <button
                                        aria-label={`Reconnect ${mailbox.emailAddress} through Google`}
                                        className="flex h-7 shrink-0 items-center gap-1 px-1 text-xs font-medium text-destructive transition-colors hover:text-destructive/80"
                                        disabled={isReconnecting}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          onReconnectMailbox(mailbox);
                                        }}
                                        type="button"
                                      >
                                        <HugeiconsIcon
                                          aria-hidden
                                          className={cn("size-3.5", {
                                            "animate-spin": isReconnecting,
                                          })}
                                          icon={isReconnecting ? Loading03Icon : Mail01Icon}
                                        />
                                        Reconnect
                                      </button>
                                      {canSetDefault && (
                                        <MailboxDefaultButton
                                          defaultMailboxLabel={defaultMailboxLabel}
                                          isDefault={isDefault}
                                          mailboxId={mailbox.id}
                                          onSetDefaultMailbox={onSetDefaultMailbox}
                                        />
                                      )}
                                      <MailboxUnreadBadge count={mailbox.unreadNonSpamCount} />
                                    </div>
                                  ) : (
                                    <MailboxSummary
                                      action={
                                        canSetDefault ? (
                                          <MailboxDefaultButton
                                            defaultMailboxLabel={defaultMailboxLabel}
                                            isDefault={isDefault}
                                            mailboxId={mailbox.id}
                                            onSetDefaultMailbox={onSetDefaultMailbox}
                                          />
                                        ) : null
                                      }
                                      className="w-full"
                                      mailbox={mailbox}
                                    />
                                  )}
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
                })}
              </>
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
