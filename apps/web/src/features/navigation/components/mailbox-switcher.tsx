"use client";

import { Modifier } from "@dnd-kit/abstract";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { type DragEndEvent, DragDropProvider } from "@dnd-kit/react";
import { isSortableOperation, useSortable } from "@dnd-kit/react/sortable";
import {
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
import {
  AnimatePresence,
  domMax,
  LayoutGroup,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  appEaseInOut,
  appEaseOut,
  appMotionDuration,
  getAppFlyInMotion,
} from "~/features/motion/app-motion";
import {
  SidebarActiveSurface,
  SidebarSimpleHoverSurface,
} from "~/features/navigation/components/sidebar-surfaces";

type MailboxSwitcherMailbox = {
  connectionStatus: "connected" | "needs_reconnect";
  displayName: string | null;
  divisionName?: string | null;
  emailAddress: string;
  groupName: string;
  id: string;
  provider: "api" | "gmail" | "managed";
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

type MailboxMenuItemProps = {
  children: ReactNode;
  isActive: boolean;
  onSelect: () => void;
};

type MailboxRowEntranceProps = {
  animateEntrance: boolean;
  children: ReactNode;
  index: number;
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
const seenMailboxEntranceIds = new Set<string>();

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

const MailboxRowEntrance = ({ animateEntrance, children, index }: MailboxRowEntranceProps) => {
  const reducedMotion = useReducedMotion();
  const [animate] = useState(animateEntrance);

  return (
    <m.div
      className="will-change-[transform,opacity,filter]"
      {...getAppFlyInMotion({ animate, index, reducedMotion })}
    >
      {children}
    </m.div>
  );
};

const MailboxMenuItem = ({ children, isActive, onSelect }: MailboxMenuItemProps) => {
  const [highlighted, setHighlighted] = useState(false);

  return (
    <DropdownMenuItem
      aria-current={isActive ? "page" : undefined}
      className="group/item squircle isolate overflow-hidden rounded-xs border border-transparent bg-transparent px-2.5 py-2 transition-transform duration-100 ease-out active:scale-[0.985] data-highlighted:bg-transparent motion-reduce:transition-none motion-reduce:active:scale-100"
      onBlur={() => setHighlighted(false)}
      onFocus={() => setHighlighted(true)}
      onMouseEnter={() => setHighlighted(true)}
      onMouseLeave={() => setHighlighted(false)}
      onSelect={onSelect}
    >
      {isActive ? (
        <SidebarActiveSurface className="rounded-xs border border-border bg-background/80 shadow-xs" />
      ) : (
        <SidebarSimpleHoverSurface
          className="inset-px rounded-xs bg-muted/70"
          layoutId="mailbox-switcher-row-hover"
          visible={highlighted}
        />
      )}
      <div className="relative z-10 w-full">{children}</div>
    </DropdownMenuItem>
  );
};

const MailboxInboxStatus = ({ mailbox }: { mailbox: MailboxSwitcherMailbox }) => {
  if (mailbox.connectionStatus === "needs_reconnect") {
    return null;
  }

  if (mailbox.provider === "api") {
    return <span className="text-xs text-muted-foreground">Send only</span>;
  }

  if (mailbox.unreadNonSpamCount === 0) {
    return null;
  }

  return (
    <span className="text-xs text-muted-foreground">
      {formatUnreadCount(mailbox.unreadNonSpamCount)}
    </span>
  );
};

const MailboxSummary = ({ action, className, mailbox }: MailboxSummaryProps) => {
  const displayName = mailbox.displayName?.trim() || null;
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-md", className)}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm/5 text-foreground">{displayName || mailbox.emailAddress}</p>
        {displayName && (
          <p className="truncate text-xs/4 text-muted-foreground">{mailbox.emailAddress}</p>
        )}
      </div>
      {action}
      <MailboxInboxStatus mailbox={mailbox} />
    </div>
  );
};

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
        "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
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
  const shouldReduceMotion = useReducedMotion();
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
    <LazyMotion features={domMax}>
      <section
        className={cn("transition-opacity duration-100", {
          "opacity-70": isDragSource,
        })}
        ref={sectionRef}
      >
        <div className="group/header squircle flex min-h-7 items-center rounded-xs transition-colors focus-within:bg-background/50 hover:bg-background/50">
          <button
            aria-expanded={!collapsed}
            className="squircle flex min-w-0 flex-1 items-center gap-2 rounded-xs px-2 py-1 text-left outline-none"
            onClick={() => onToggle(group.id)}
            ref={headerRef}
            type="button"
          >
            <m.span
              animate={{
                transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
              }}
              className="flex size-3 shrink-0 items-center justify-center text-muted-foreground/70"
              initial={false}
              transition={{
                duration: shouldReduceMotion ? 0 : appMotionDuration.layout,
                ease: appEaseInOut,
              }}
            >
              <HugeiconsIcon aria-hidden className="size-3" icon={ArrowRight01Icon} />
            </m.span>
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
              animate={{ height: "auto", opacity: 1 }}
              className="overflow-hidden"
              exit={{ height: shouldReduceMotion ? "auto" : 0, opacity: 0 }}
              initial={{ height: shouldReduceMotion ? "auto" : 0, opacity: 0 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0.1 }
                  : {
                      height: { duration: 0.18, ease: [0.23, 1, 0.32, 1] },
                      opacity: { duration: 0.12, ease: [0.23, 1, 0.32, 1] },
                    }
              }
            >
              <div className="space-y-1 pt-1">{children}</div>
            </m.div>
          )}
        </AnimatePresence>
      </section>
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
      ]
        .filter(Boolean)
        .join(" / ")
    : "No team";
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const [isOpen, setIsOpen] = useState(false);
  const [isTriggerHovered, setIsTriggerHovered] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isFiltering = normalizedSearchQuery.length > 0;
  const canReorderGroups = !isFiltering && groups.length > 1;
  const mailboxEntranceIds = new Set(
    isOpen
      ? mailboxes
          .filter((mailbox) => !seenMailboxEntranceIds.has(mailbox.id))
          .map((mailbox) => mailbox.id)
      : [],
  );
  const mailboxEntranceIndexById = new Map(mailboxes.map((mailbox, index) => [mailbox.id, index]));
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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    for (const mailbox of mailboxes) {
      seenMailboxEntranceIds.add(mailbox.id);
    }
  }, [isOpen, mailboxes]);

  return (
    <DropdownMenu onOpenChange={setIsOpen} open={isOpen}>
      <div
        className="squircle relative min-w-0 flex-1 rounded-md"
        onMouseEnter={() => setIsTriggerHovered(true)}
        onMouseLeave={() => setIsTriggerHovered(false)}
      >
        <SidebarSimpleHoverSurface layoutId="mailbox-switcher-hover" visible={isTriggerHovered} />
        <DropdownMenuTrigger
          aria-label="Switch mailbox"
          className="squircle relative z-10 w-full min-w-0 rounded-md px-3 py-2 text-left outline-none hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-100"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <m.div
              key={`${selectedMailbox?.id ?? "empty"}:${primaryLabel}:${secondaryLabel}`}
              animate={{ opacity: 1 }}
              className="min-w-0"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              transition={{ duration: appMotionDuration.feedback, ease: appEaseOut }}
            >
              <p className="truncate text-[13px]/5 font-medium tracking-tight text-foreground">
                {primaryLabel}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{secondaryLabel}</p>
            </m.div>
          </AnimatePresence>
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))]"
        side={side}
        sideOffset={10}
      >
        <DragDropProvider onDragEnd={handleGroupDragEnd}>
          <LayoutGroup id="mailbox-switcher-rows">
            <div className="flex max-h-96 flex-col gap-1 overflow-y-auto p-1">
              {mailboxes.length > 0 ? (
                <>
                  {(mailboxes.length >= 8 || isFiltering) && (
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
                  )}
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
                                  <MailboxRowEntrance
                                    animateEntrance={mailboxEntranceIds.has(mailbox.id)}
                                    index={mailboxEntranceIndexById.get(mailbox.id) ?? 0}
                                  >
                                    <MailboxMenuItem
                                      isActive={isActive}
                                      onSelect={() => onSelectMailboxId(mailbox.id)}
                                    >
                                      <MailboxSummary
                                        action={
                                          <div className="flex items-center gap-1">
                                            {needsReconnect && (
                                              <button
                                                aria-label={`Reconnect ${mailbox.emailAddress} through Google`}
                                                className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-destructive/20 bg-destructive/10 px-1.5 text-xs font-medium text-destructive transition-[color,transform] duration-100 hover:text-destructive/80 active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:scale-100"
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
                                            )}
                                            {canSetDefault && (
                                              <MailboxDefaultButton
                                                defaultMailboxLabel={defaultMailboxLabel}
                                                isDefault={isDefault}
                                                mailboxId={mailbox.id}
                                                onSetDefaultMailbox={onSetDefaultMailbox}
                                              />
                                            )}
                                          </div>
                                        }
                                        className="w-full"
                                        mailbox={mailbox}
                                      />
                                    </MailboxMenuItem>
                                  </MailboxRowEntrance>
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
                  {!embedded && (
                    <div className="border-t border-border pt-1">
                      <LinkButton
                        className="squircle h-auto min-h-9 w-full justify-between rounded-xs px-2.5 py-2"
                        search={{ from: "/", mailboxId: "", tab: "mailboxes" }}
                        size="sm"
                        to="/settings"
                        variant="ghost"
                      >
                        Manage mailboxes
                        <HugeiconsIcon aria-hidden className="size-4" icon={Settings01Icon} />
                      </LinkButton>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-md px-2.5 py-2 text-sm text-muted-foreground">
                  No Mailbox
                </div>
              )}
            </div>
          </LayoutGroup>
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
