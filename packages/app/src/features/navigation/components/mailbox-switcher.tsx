"use client";

import { CollisionPriority, CollisionType, Modifier } from "@dnd-kit/abstract";
import type { CollisionDetector } from "@dnd-kit/abstract";
import {
  Accessibility,
  defaultPreset,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import type { Draggable, DragDropManager } from "@dnd-kit/dom";
import {
  DragDropProvider,
  DragOverlay,
  useDraggable,
  useDroppable,
  useDragOperation,
  useDragDropManager,
} from "@dnd-kit/react";
import type { DragDropEventHandlers } from "@dnd-kit/react";
import {
  ArrowRight01Icon,
  Loading03Icon,
  Mail01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import {
  appEaseOut,
  appMotionDuration,
} from "@quieter/app/features/motion/app-motion";
import { Button, LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { AnimatePresence, m, useReducedMotion, useSpring } from "motion/react";
import type { MotionValue } from "motion/react";
import { useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  Ref,
} from "react";
import { createPortal } from "react-dom";

type MailboxSwitcherMailbox = {
  accessMode?: "private" | "shared" | null;
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

type MailboxSwitcherDropdownProps = {
  allInboxesActive?: boolean;
  onSelectAllInboxes?: () => void;
  embedded?: boolean;
  groups: MailboxSwitcherGroup[];
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onReconnectMailbox: (
    mailbox: Pick<MailboxSwitcherMailbox, "emailAddress" | "id">
  ) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  reconnectingMailboxId: string | null;
  selectedMailboxId: string | null;
  side?: "bottom" | "right";
};

const getMailboxSwitcherSummary = (
  mailboxes: MailboxSwitcherMailbox[],
  selectedMailboxId: string | null
) => {
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ??
    mailboxes[0] ??
    null;
  const selectedDisplayName = selectedMailbox?.displayName?.trim() ?? null;
  const primaryLabel =
    selectedDisplayName || (selectedMailbox?.emailAddress ?? "no mailbox");
  const secondaryLabel =
    selectedMailbox === null
      ? "No team"
      : [
          selectedDisplayName ? selectedMailbox.emailAddress : null,
          selectedMailbox.groupName,
        ]
          .filter((value): value is string => value !== null)
          .join(" / ");

  return { primaryLabel, secondaryLabel, selectedMailbox };
};

const filterMailboxGroups = (
  groups: MailboxSwitcherGroup[],
  normalizedSearchQuery: string
) =>
  groups.flatMap((group) => {
    const matchingMailboxes = group.mailboxes.filter((mailbox) =>
      [
        mailbox.displayName,
        mailbox.emailAddress,
        mailbox.groupName,
        mailbox.divisionName,
        mailbox.grantRole,
        mailbox.provider,
      ]
        .filter(
          (value): value is string => value !== null && value !== undefined
        )
        .some((value) => value.toLowerCase().includes(normalizedSearchQuery))
    );
    return matchingMailboxes.length > 0 ||
      group.name.toLowerCase().includes(normalizedSearchQuery)
      ? [{ ...group, mailboxes: matchingMailboxes }]
      : [];
  });

type SwitcherDragData = {
  groupId: string;
  mailboxId?: string;
  index: number;
  label: string;
  offset: MotionValue<number>;
};

const SWITCHER_SENSORS = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ tolerance: 8, value: 220 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
];

// Read live bounds because team headers move while their mailbox lists collapse.
const switcherCollision: CollisionDetector = ({ droppable, dragOperation }) => {
  const element = "element" in droppable ? droppable.element : null;
  if (!(element instanceof HTMLElement)) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  const { x, y } = dragOperation.position.current;
  const panel = element
    .closest("[data-mailbox-switcher-list]")
    ?.getBoundingClientRect();
  if (
    !panel ||
    x < panel.left ||
    x > panel.right ||
    y < panel.top ||
    y > panel.bottom
  ) {
    return null;
  }
  return {
    id: droppable.id,
    priority: CollisionPriority.Normal,
    type: CollisionType.Collision,
    value: -Math.abs(y - (rect.top + rect.height / 2)),
  };
};

// Move only the row contents so collision targets stay stable while the preview changes.
const updateDragPreview = (manager: DragDropManager<SwitcherDragData>) => {
  const { source } = manager.dragOperation;
  const [collision] = manager.collisionObserver.computeCollisions();
  const target =
    collision === undefined
      ? null
      : manager.registry.droppables.get(collision.id);
  const sourceRect = source?.element?.getBoundingClientRect();
  const targetRect = target?.element?.getBoundingClientRect();
  for (const row of manager.registry.droppables) {
    let offset = 0;
    if (
      source &&
      target &&
      sourceRect &&
      targetRect &&
      row.type === source.type
    ) {
      const from = source.data.index;
      const to = target.data.index;
      if (row.id === source.id) {
        offset =
          to > from
            ? targetRect.bottom - sourceRect.bottom
            : targetRect.top - sourceRect.top;
      } else if (row.data.index > from && row.data.index <= to) {
        offset = -sourceRect.height - 4;
      } else if (row.data.index < from && row.data.index >= to) {
        offset = sourceRect.height + 4;
      }
    }
    row.data.offset.set(offset);
  }
};

class RestrictToVerticalAxis extends Modifier {
  override apply({ transform }: Parameters<Modifier["apply"]>[0]) {
    return { x: 0, y: transform.y };
  }
}

const VERTICAL_AXIS_MODIFIERS = [RestrictToVerticalAxis];

const moveItem = <TValue,>(
  items: TValue[],
  fromIndex: number,
  toIndex: number
) => {
  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);

  if (item === undefined) {
    return items;
  }

  nextItems.splice(toIndex, 0, item);
  return nextItems;
};

const getMailboxSwitcherOrder = (
  groups: MailboxSwitcherGroup[]
): MailboxSwitcherOrder => ({
  groupIds: groups.map((group) => group.id),
  mailboxIdsByGroupId: Object.fromEntries(
    groups.map((group) => [
      group.id,
      group.mailboxes.map((mailbox) => mailbox.id),
    ])
  ),
});

const formatUnreadCount = (count: number) =>
  count > 99 ? "99+" : String(Math.max(0, count));

const ReorderRow = ({
  children,
  data,
  disabled,
}: {
  children: (handleRef: Ref<HTMLButtonElement>) => ReactNode;
  data: Omit<SwitcherDragData, "offset">;
  disabled: boolean;
}) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const offset = useSpring(0, {
    bounce: 0,
    duration: reducedMotion === true ? 0 : 0.2,
  });
  const dragData = { ...data, offset };
  const handleRef = useRef<HTMLButtonElement>(null);
  const id = JSON.stringify([data.groupId, data.mailboxId ?? null]);
  const type = data.mailboxId ? `mailboxes:${data.groupId}` : "teams";
  const { isDragSource } = useDraggable<SwitcherDragData>({
    data: dragData,
    disabled,
    element: elementRef,
    handle: handleRef,
    id,
    modifiers: VERTICAL_AXIS_MODIFIERS,
    sensors: SWITCHER_SENSORS,
    type,
  });
  useDroppable({
    accept: type,
    collisionDetector: switcherCollision,
    data: dragData,
    disabled,
    element: elementRef,
    id,
    type,
  });
  const { source } = useDragOperation<SwitcherDragData>();
  return (
    <div
      className="relative rounded-xs"
      data-mailbox-switcher-group={data.groupId}
      data-mailbox-switcher-mailbox={data.mailboxId}
      data-mailbox-switcher-navigation-row
      ref={elementRef}
    >
      <m.div
        aria-hidden={isDragSource ? true : undefined}
        className={cn("rounded-xs", {
          "bg-muted/60 opacity-35 ring-1 ring-border": isDragSource,
          "pointer-events-none": source !== null && source !== undefined,
        })}
        data-mailbox-switcher-ghost={isDragSource ? true : undefined}
        // oxlint-disable-next-line shadcn/no-inline-styles -- Motion value previews row positions without moving the collision targets.
        style={{ y: offset }}
      >
        {children(handleRef)}
      </m.div>
    </div>
  );
};

const MailboxMenuItem = ({
  action,
  children,
  isActive,
  onSelect,
  handleRef,
}: {
  action?: ReactNode;
  children: ReactNode;
  isActive: boolean;
  onSelect: () => void;
  handleRef: Ref<HTMLButtonElement>;
}) => (
  <div
    className={cn(
      "group/item flex items-center rounded-xs squircle focus-within:bg-muted/60 hover:bg-muted/60 dark:hover:bg-muted/40",
      {
        "bg-muted/60 dark:bg-muted/40": isActive,
      }
    )}
  >
    <Button
      aria-current={isActive ? "page" : undefined}
      aria-describedby="mailbox-order-help"
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      // oxlint-disable-next-line shadcn/no-restyle -- Compact full-row mailbox selection and drag surface.
      className="h-auto min-h-12 min-w-0 flex-1 touch-pan-y justify-start rounded-xs px-2.5 py-2 text-left hover:bg-transparent active:scale-100 aria-[current=page]:bg-transparent"
      data-mailbox-switcher-navigation-item
      onClick={(event) => {
        if (!event.defaultPrevented) {
          onSelect();
        }
      }}
      ref={handleRef}
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
    {action !== null && action !== undefined && action !== false && (
      <div className="flex shrink-0 items-center gap-1 pr-2.5">{action}</div>
    )}
  </div>
);

const MailboxInboxStatus = ({
  mailbox,
}: {
  mailbox: MailboxSwitcherMailbox;
}) => {
  if (mailbox.connectionStatus === "needs_reconnect") {
    return null;
  }

  if (mailbox.provider === "api") {
    return <span className="text-caption text-muted-fg">Send only</span>;
  }

  if (mailbox.unreadNonSpamCount === 0) {
    return null;
  }

  return (
    <span className="text-caption text-muted-fg">
      {formatUnreadCount(mailbox.unreadNonSpamCount)}
    </span>
  );
};

const MailboxSummary = ({
  action,
  className,
  mailbox,
}: MailboxSummaryProps) => {
  const trimmedDisplayName = mailbox.displayName?.trim();
  const displayName =
    trimmedDisplayName === undefined || trimmedDisplayName === ""
      ? null
      : trimmedDisplayName;
  return (
    <div
      className={cn("flex min-w-0 items-center gap-2 rounded-md", className)}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-body/5 text-fg">
          {displayName ?? mailbox.emailAddress}
        </p>
        {displayName !== null && (
          <p className="truncate text-caption/4 text-muted-fg">
            {mailbox.emailAddress}
          </p>
        )}
      </div>
      {mailbox.provider === "managed" && (
        <span className="shrink-0 text-caption text-muted-fg">
          {mailbox.accessMode === "private" ? "Private" : "Shared"}
        </span>
      )}
      {action}
      <MailboxInboxStatus mailbox={mailbox} />
    </div>
  );
};

const MailboxTeam = ({
  children,
  collapsed,
  disabled,
  embedded,
  group,
  index,
  sortingTeams,
  onToggle,
  onRestored,
}: {
  children: ReactNode;
  collapsed: boolean;
  disabled: boolean;
  embedded: boolean;
  group: MailboxSwitcherGroup;
  index: number;
  sortingTeams: boolean;
  onToggle: (id: string) => void;
  onRestored: () => void;
}) => {
  const reducedMotion = useReducedMotion();
  const closed = collapsed || sortingTeams;
  const dragManager = useDragDropManager<SwitcherDragData>();
  return (
    <section data-mailbox-switcher-team={group.id}>
      <ReorderRow
        data={{ groupId: group.id, index, label: group.name }}
        disabled={disabled}
      >
        {(handleRef) => (
          <div className="group/header flex min-h-7 items-center rounded-xs squircle focus-within:bg-muted/60 hover:bg-muted/60 dark:hover:bg-muted/40">
            <Button
              aria-describedby={disabled ? undefined : "mailbox-order-help"}
              aria-expanded={!closed}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              // oxlint-disable-next-line shadcn/no-restyle -- Team header preserves the compact selector hierarchy.
              className="h-auto min-h-7 min-w-0 flex-1 touch-pan-y justify-start gap-2 rounded-xs px-2 py-1 text-left hover:bg-transparent active:scale-100"
              data-mailbox-switcher-navigation-item
              onClick={(event) => {
                if (!event.defaultPrevented) {
                  onToggle(group.id);
                }
              }}
              ref={handleRef}
              variant="ghost"
            >
              <m.span
                animate={{ rotate: closed ? 0 : 90 }}
                className="flex size-3 shrink-0 items-center justify-center text-muted-fg/70"
                initial={false}
                transition={{
                  duration: reducedMotion === true ? 0 : 0.2,
                  ease: appEaseOut,
                }}
              >
                <Icon aria-hidden size={12} icon={ArrowRight01Icon} />
              </m.span>
              <span className="min-w-0 flex-1 truncate text-caption text-muted-fg">
                {group.name}
              </span>
            </Button>
            {group.kind === "organization" && !embedded && (
              <IconButtonTooltip label={`Open ${group.name} settings`}>
                <LinkButton
                  aria-label={`Open ${group.name} settings`}
                  // oxlint-disable-next-line shadcn/no-restyle -- Compact settings action reveals on hover and focus.
                  className="mr-0.5 size-7 opacity-0 group-focus-within/header:opacity-100 group-hover/header:opacity-100 focus-visible:opacity-100"
                  data-mailbox-switcher-navigation-action
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
                  <Icon aria-hidden icon={Settings01Icon} />
                </LinkButton>
              </IconButtonTooltip>
            )}
          </div>
        )}
      </ReorderRow>
      <m.div
        animate={{ height: closed ? 0 : "auto", opacity: closed ? 0 : 1 }}
        className="overflow-hidden"
        inert={closed}
        onUpdate={() => {
          if (sortingTeams) {
            dragManager?.collisionObserver.forceUpdate(true);
            if (dragManager) {
              updateDragPreview(dragManager);
            }
          }
        }}
        onAnimationComplete={() => {
          if (!closed) {
            onRestored();
          }
        }}
        initial={false}
        transition={{
          height: {
            duration: reducedMotion === true ? 0 : 0.24,
            ease: appEaseOut,
          },
          opacity: { duration: reducedMotion === true ? 0 : 0.16 },
        }}
      >
        <div className="space-y-1 pt-1">{children}</div>
      </m.div>
    </section>
  );
};

const getFocusedNavigationItem = (
  target: HTMLElement,
  primaryItem: HTMLElement | null | undefined
) => {
  const currentItem =
    target.closest<HTMLElement>("[data-mailbox-switcher-navigation-item]") ??
    primaryItem;
  if (currentItem !== null && currentItem !== undefined) {
    return currentItem;
  }

  const { activeElement } = document;
  return activeElement instanceof HTMLElement ? activeElement : null;
};

export const MailboxSwitcherDropdown = ({
  allInboxesActive = false,
  onSelectAllInboxes,
  embedded = false,
  groups,
  onReorderMailboxSwitcher,
  onReconnectMailbox,
  onSelectMailboxId,
  reconnectingMailboxId,
  selectedMailboxId,
  side = "right",
}: MailboxSwitcherDropdownProps) => {
  const mailboxes = groups.flatMap((group) => group.mailboxes);
  const { primaryLabel, secondaryLabel, selectedMailbox } =
    getMailboxSwitcherSummary(mailboxes, selectedMailboxId);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingTeam, setDraggingTeam] = useState(false);
  const [dragPanelHeight, setDragPanelHeight] = useState<number>();
  const listRef = useRef<HTMLDivElement>(null);
  const dragManagerRef = useRef<DragDropManager<SwitcherDragData> | null>(null);
  const handleEscapeCapture = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || !dragManagerRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragManagerRef.current.actions.stop({
      canceled: true,
      event: event.nativeEvent,
    });
  };
  const [orderAnnouncement, setOrderAnnouncement] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isFiltering = normalizedSearchQuery.length > 0;
  const canReorderGroups = !isFiltering && groups.length > 1;
  const handleArrowNavigation = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    const { target } = event;
    if (event.key === "/" && !(target instanceof HTMLInputElement)) {
      event.preventDefault();
      searchRef.current?.focus();
      return;
    }
    if (
      event.altKey &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      const groupId = target.closest<HTMLElement>(
        "[data-mailbox-switcher-group]"
      )?.dataset.mailboxSwitcherGroup;
      const mailboxId = target.closest<HTMLElement>(
        "[data-mailbox-switcher-mailbox]"
      )?.dataset.mailboxSwitcherMailbox;
      const groupIndex = groups.findIndex((group) => group.id === groupId);
      const group = groups[groupIndex];
      if (isFiltering || groupIndex === -1) {
        return;
      }
      event.preventDefault();
      const items = mailboxId ? group.mailboxes : groups;
      const fromIndex = mailboxId
        ? group.mailboxes.findIndex((mailbox) => mailbox.id === mailboxId)
        : groupIndex;
      const toIndex = fromIndex + (event.key === "ArrowDown" ? 1 : -1);
      if (fromIndex < 0 || toIndex < 0 || toIndex >= items.length) {
        return;
      }
      if (mailboxId) {
        const nextGroups = groups.map((candidate) =>
          candidate.id === group.id
            ? {
                ...candidate,
                mailboxes: moveItem(candidate.mailboxes, fromIndex, toIndex),
              }
            : candidate
        );
        onReorderMailboxSwitcher(getMailboxSwitcherOrder(nextGroups));
        setOrderAnnouncement(
          `Mailbox moved to position ${toIndex + 1} of ${items.length} in ${group.name}.`
        );
      } else {
        onReorderMailboxSwitcher(
          getMailboxSwitcherOrder(moveItem(groups, fromIndex, toIndex))
        );
        setOrderAnnouncement(
          `${group.name} moved to position ${toIndex + 1} of ${groups.length}.`
        );
      }
      return;
    }
    if (target instanceof HTMLInputElement && event.key !== "ArrowDown") {
      return;
    }
    const row = target.closest<HTMLElement>(
      "[data-mailbox-switcher-navigation-row]"
    );
    const primaryItem = row?.querySelector<HTMLElement>(
      "[data-mailbox-switcher-navigation-item]"
    );
    const action = row?.querySelector<HTMLElement>(
      "[data-mailbox-switcher-navigation-action]"
    );

    if (
      event.key === "ArrowRight" &&
      target.closest("[data-mailbox-switcher-navigation-item]")
    ) {
      if (action) {
        event.preventDefault();
        action.focus();
      }
      return;
    }

    if (
      event.key === "ArrowLeft" &&
      target.closest("[data-mailbox-switcher-navigation-action]")
    ) {
      if (primaryItem) {
        event.preventDefault();
        primaryItem.focus();
      }
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    const items = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        "[data-mailbox-switcher-navigation-item]"
      ),
    ].filter(
      (item) =>
        !item.matches(":disabled") &&
        !item.closest("[inert]") &&
        item.checkVisibility()
    );
    if (target instanceof HTMLInputElement) {
      event.preventDefault();
      items[0]?.focus();
      return;
    }
    const focusedItem = getFocusedNavigationItem(target, primaryItem);
    if (focusedItem === null) {
      return;
    }
    const currentIndex = items.indexOf(focusedItem);

    if (currentIndex === -1) {
      return;
    }

    event.preventDefault();
    let nextIndex = Math.max(
      0,
      Math.min(
        items.length - 1,
        currentIndex + (event.key === "ArrowDown" ? 1 : -1)
      )
    );
    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }
    items[nextIndex]?.focus();
  };
  const filteredGroups = filterMailboxGroups(groups, normalizedSearchQuery);
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
  const handleDragEnd: DragDropEventHandlers<SwitcherDragData>["onDragEnd"] = (
    event,
    manager
  ) => {
    for (const row of manager.registry.droppables) {
      row.data.offset.jump(0);
    }
    dragManagerRef.current = null;
    setIsDragging(false);
    setDraggingTeam(false);
    if (
      !draggingTeam ||
      groups.every((group) => collapsedGroupIds.has(group.id))
    ) {
      setDragPanelHeight(undefined);
    }
    const { source } = event.operation;
    const [collision] = manager.collisionObserver.computeCollisions();
    const target =
      collision === undefined
        ? null
        : manager.registry.droppables.get(collision.id);
    if (
      event.canceled ||
      !source ||
      !target ||
      source.id === target.id ||
      source.type !== target.type
    ) {
      return;
    }
    const from = source.data;
    const to = target.data;
    const nextGroups = from.mailboxId
      ? groups.map((group) =>
          group.id === from.groupId
            ? {
                ...group,
                mailboxes: moveItem(group.mailboxes, from.index, to.index),
              }
            : group
        )
      : moveItem(groups, from.index, to.index);
    onReorderMailboxSwitcher(getMailboxSwitcherOrder(nextGroups));
    setOrderAnnouncement(`${from.label} moved to position ${to.index + 1}.`);
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open && isDragging) {
          return;
        }
        setIsOpen(open);
        if (!open) {
          setDraggingTeam(false);
          setDragPanelHeight(undefined);
          setSearchQuery("");
        }
      }}
      open={isOpen}
    >
      <div className="relative min-w-0 flex-1 rounded-md squircle hover:bg-muted/60 dark:hover:bg-muted/40">
        <PopoverTrigger
          onKeyDownCapture={handleEscapeCapture}
          aria-label="Switch mailbox"
          // oxlint-disable-next-line shadcn/no-restyle -- Switcher trigger keeps its nav metrics.
          className="relative z-10 w-full min-w-0 rounded-md px-3 py-2 text-left squircle hover:bg-transparent hover:text-fg active:scale-100"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <m.div
              key={`${selectedMailbox?.id ?? "empty"}:${primaryLabel}:${secondaryLabel}`}
              animate={{ opacity: 1 }}
              className="min-w-0"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              transition={{
                duration: appMotionDuration.feedback,
                ease: appEaseOut,
              }}
            >
              <p className="truncate text-body-sm/5 font-medium tracking-tight text-fg">
                {allInboxesActive ? "All inboxes" : primaryLabel}
              </p>
              <p className="mt-1 truncate text-caption text-muted-fg">
                {allInboxesActive
                  ? "Your selected inboxes, together"
                  : secondaryLabel}
              </p>
            </m.div>
          </AnimatePresence>
        </PopoverTrigger>
      </div>

      <PopoverContent
        onKeyDownCapture={handleEscapeCapture}
        align="start"
        // oxlint-disable-next-line shadcn/no-restyle -- Switcher popover keeps its compact panel.
        className="w-[min(20rem,calc(100vw-2rem))] p-1"
        side={side}
        sideOffset={10}
      >
        <DragDropProvider<SwitcherDragData>
          plugins={defaultPreset.plugins.filter(
            (plugin) => plugin !== Accessibility
          )}
          onDragMove={(_event, manager) => {
            updateDragPreview(manager);
          }}
          onDragOver={(_event, manager) => {
            updateDragPreview(manager);
          }}
          onDragEnd={handleDragEnd}
          onDragStart={(event, manager) => {
            dragManagerRef.current = manager;
            setIsDragging(true);
            setDragPanelHeight(listRef.current?.getBoundingClientRect().height);
            setDraggingTeam(event.operation.source?.type === "teams");
          }}
        >
          <div
            className="flex max-h-96 flex-col gap-1 overflow-y-auto p-1"
            data-mailbox-switcher-list
            onKeyDown={handleArrowNavigation}
            ref={listRef}
            // oxlint-disable-next-line shadcn/no-inline-styles -- Freeze measured panel height while dragging to keep the popover anchored.
            style={{ minHeight: dragPanelHeight }}
          >
            {groups.length > 0 ? (
              <>
                {onSelectAllInboxes &&
                mailboxes.some((mailbox) => mailbox.provider !== "api") ? (
                  <Button
                    aria-current={allInboxesActive ? "page" : undefined}
                    className="w-full justify-start"
                    data-mailbox-switcher-navigation-item
                    onClick={() => {
                      onSelectAllInboxes();
                      setIsOpen(false);
                    }}
                    variant="ghost"
                  >
                    <Icon aria-hidden icon={Mail01Icon} />
                    All inboxes
                  </Button>
                ) : null}
                {(mailboxes.length >= 8 || isFiltering) && (
                  <div className="sticky top-0 z-10 bg-popover">
                    <Input
                      aria-label="Search mailboxes"
                      onChange={(event) => {
                        setSearchQuery(event.currentTarget.value);
                      }}
                      placeholder="Search mailboxes"
                      ref={searchRef}
                      value={searchQuery}
                    />
                  </div>
                )}
                {(isFiltering ? filteredGroups : groups).map(
                  (group, groupIndex) => {
                    const isCollapsed =
                      !isFiltering && collapsedGroupIds.has(group.id);
                    const canReorderMailboxes =
                      !isFiltering && group.mailboxes.length > 1;

                    return (
                      <MailboxTeam
                        collapsed={isCollapsed}
                        disabled={!canReorderGroups}
                        embedded={embedded}
                        group={group}
                        index={groupIndex}
                        key={group.id}
                        onRestored={() => {
                          setDragPanelHeight(undefined);
                        }}
                        onToggle={toggleGroup}
                        sortingTeams={draggingTeam}
                      >
                        {group.mailboxes.length > 0 ? (
                          group.mailboxes.map((mailbox, mailboxIndex) => {
                            const isActive =
                              !allInboxesActive &&
                              mailbox.id === selectedMailboxId;
                            const needsReconnect =
                              mailbox.connectionStatus === "needs_reconnect";
                            const isReconnecting =
                              reconnectingMailboxId === mailbox.id;

                            return (
                              <ReorderRow
                                disabled={
                                  !canReorderMailboxes ||
                                  isCollapsed ||
                                  draggingTeam
                                }
                                data={{
                                  groupId: group.id,
                                  index: mailboxIndex,
                                  label:
                                    mailbox.displayName ?? mailbox.emailAddress,
                                  mailboxId: mailbox.id,
                                }}
                                key={mailbox.id}
                              >
                                {(handleRef) => (
                                  <MailboxMenuItem
                                    handleRef={handleRef}
                                    action={
                                      <div className="flex items-center gap-1">
                                        {needsReconnect && (
                                          <button
                                            aria-label={`Reconnect ${mailbox.emailAddress} through Google`}
                                            // oxlint-disable-next-line shadcn/no-arbitrary-values -- Explicit transition properties for the reconnect affordance.
                                            className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-destructive/20 bg-destructive/10 px-1.5 text-caption font-medium text-destructive transition-[color,transform] duration-100 hover:text-destructive/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised focus-visible:outline-none active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:scale-100"
                                            data-mailbox-switcher-navigation-action
                                            disabled={isReconnecting}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              onReconnectMailbox(mailbox);
                                            }}
                                            type="button"
                                          >
                                            <Icon
                                              aria-hidden
                                              size={14}
                                              animation={
                                                isReconnecting
                                                  ? "spin"
                                                  : undefined
                                              }
                                              icon={
                                                isReconnecting
                                                  ? Loading03Icon
                                                  : Mail01Icon
                                              }
                                            />
                                            Reconnect
                                          </button>
                                        )}
                                      </div>
                                    }
                                    isActive={isActive}
                                    onSelect={() => {
                                      onSelectMailboxId(mailbox.id);
                                      setIsOpen(false);
                                    }}
                                  >
                                    <MailboxSummary
                                      className="w-full"
                                      mailbox={mailbox}
                                    />
                                  </MailboxMenuItem>
                                )}
                              </ReorderRow>
                            );
                          })
                        ) : (
                          <p className="px-2 py-1 text-body text-muted-fg">
                            No Mailbox
                          </p>
                        )}
                      </MailboxTeam>
                    );
                  }
                )}
                <p className="sr-only" id="mailbox-order-help">
                  Alt + Up or Down to reorder the focused team or mailbox.
                </p>
                {isFiltering && filteredGroups.length === 0 && (
                  <p className="px-2 py-3 text-body-sm text-muted-fg">
                    No matching mailboxes
                  </p>
                )}
                <output aria-live="polite" className="sr-only">
                  {orderAnnouncement}
                </output>
                {!embedded && (
                  <div className="mt-1">
                    <LinkButton
                      // oxlint-disable-next-line shadcn/no-restyle -- Manage row keeps its compact nav metrics.
                      className="h-auto min-h-7 w-full justify-between rounded-xs px-2.5 py-1 squircle"
                      data-mailbox-switcher-navigation-item
                      search={{ from: "/", mailboxId: "", tab: "mailboxes" }}
                      size="sm"
                      to="/settings"
                      variant="ghost"
                    >
                      Manage mailboxes
                      <Icon aria-hidden icon={Settings01Icon} />
                    </LinkButton>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-md px-2.5 py-2 text-body text-muted-fg">
                No Mailbox
              </div>
            )}
          </div>
          {isOpen &&
            createPortal(
              <DragOverlay<SwitcherDragData, Draggable<SwitcherDragData>>
                className="pointer-events-none z-50 rounded-xs bg-popover shadow-md ring-1 ring-border"
                dropAnimation={null}
              >
                {(source) => {
                  const { data } = source;
                  const group = groups.find((item) => item.id === data.groupId);
                  const mailbox = group?.mailboxes.find(
                    (item) => item.id === data.mailboxId
                  );
                  return mailbox ? (
                    <div
                      aria-hidden
                      className={cn("px-2.5 py-2", {
                        "pr-10": mailbox.provider !== "api",
                      })}
                    >
                      <MailboxSummary mailbox={mailbox} />
                    </div>
                  ) : (
                    <div
                      aria-hidden
                      className="flex min-h-7 items-center gap-2 px-2 py-1 text-caption text-muted-fg"
                    >
                      <Icon size={12} icon={ArrowRight01Icon} />
                      {group?.name}
                    </div>
                  );
                }}
              </DragOverlay>,
              document.body
            )}
        </DragDropProvider>
      </PopoverContent>
    </Popover>
  );
};
