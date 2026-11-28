"use client";

import { CollisionPriority, CollisionType, Modifier } from "@dnd-kit/abstract";
import type { CollisionDetector } from "@dnd-kit/abstract";
import {
  Accessibility,
  Cursor,
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
  ArrowDown01Icon,
  ArrowRight01Icon,
  Loading03Icon,
  Mail01Icon,
  Settings01Icon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import {
  appEaseOut,
  appMotionDuration,
} from "@quieter/app/features/motion/app-motion";
import { warmSettingsDestination } from "@quieter/app/lib/background-prefetch";
import { usePreviewPersona } from "@quieter/app/lib/preview-personas";
import { Button, LinkButton } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuViewport,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import {
  reorderAnimation,
  reorderTransition,
} from "@quieter/ui/reorder-motion";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import {
  AnimatePresence,
  animate,
  m,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react";
import { createPortal } from "react-dom";

type MailboxSwitcherMailbox = {
  accessMode: "private" | "shared" | null;
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
  className?: string;
  mailbox: MailboxSwitcherMailbox;
};

type MailboxSwitcherDropdownProps = {
  accountLabel?: string;
  allInboxesActive?: boolean;
  onSelectAllInboxes?: () => void;
  embedded?: boolean;
  groups: MailboxSwitcherGroup[];
  isLoading?: boolean;
  onReorderMailboxSwitcher: (order: MailboxSwitcherOrder) => void;
  onReconnectMailbox: (
    mailbox: Pick<MailboxSwitcherMailbox, "emailAddress" | "id">
  ) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  reconnectingMailboxId: string | null;
  selectedMailboxId: string | null;
  side?: "bottom" | "right";
  unifiedInboxExcludedIds: readonly string[];
};

const getMailboxSwitcherSummary = (
  mailboxes: MailboxSwitcherMailbox[],
  selectedMailboxId: string | null
) => {
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === selectedMailboxId) ??
    mailboxes[0] ??
    null;
  const selectedDisplayName = selectedMailbox?.displayName?.trim();
  const primaryLabel =
    selectedDisplayName || (selectedMailbox?.emailAddress ?? "no mailbox");
  const secondaryLabel =
    (selectedDisplayName
      ? selectedMailbox?.emailAddress
      : selectedMailbox?.groupName) ?? "No team";

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
  moveOffset: (offset: number | "hold") => void;
};

type ReorderSnapshot = {
  nextOrderKey: string;
  orderKey: string;
  restore?: () => void;
  timeout: number;
  tops: Map<string, number>;
};

type ReorderSettle = {
  orderKey: string;
  snapshot: RefObject<ReorderSnapshot | null>;
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
// Clamp the pointer into the visible list so drags past an edge keep the nearest row.
const getSwitcherCollision = (
  droppable: Parameters<CollisionDetector>[0]["droppable"],
  pointerY: number
) => {
  const element = "element" in droppable ? droppable.element : null;
  const list =
    element instanceof HTMLElement
      ? element.closest("[data-mailbox-switcher-list]")
      : null;
  if (!(element instanceof HTMLElement) || !list) {
    return null;
  }
  const panel = list.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  if (rect.bottom <= panel.top || rect.top >= panel.bottom) {
    return null;
  }
  const y = Math.min(Math.max(pointerY, panel.top), panel.bottom);
  return {
    id: droppable.id,
    priority: CollisionPriority.Normal,
    type: CollisionType.Collision,
    value: -Math.abs(y - (rect.top + rect.height / 2)),
  };
};

const getSwitcherDropTarget = (
  manager: DragDropManager<SwitcherDragData>,
  source: Draggable<SwitcherDragData>,
  event: Event | undefined
) => {
  if (!(event instanceof PointerEvent)) {
    const [collision] = manager.collisionObserver.computeCollisions();
    return collision === undefined
      ? undefined
      : manager.registry.droppables.get(collision.id);
  }

  // Pointer moves are processed on the next frame, which can be after release.
  let nearestValue = -Infinity;
  let target;
  for (const row of manager.registry.droppables) {
    if (row.disabled || !row.accepts(source)) {
      continue;
    }
    const collision = getSwitcherCollision(row, event.clientY);
    if (collision !== null && collision.value > nearestValue) {
      nearestValue = collision.value;
      target = row;
    }
  }
  return target;
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
    row.data.moveOffset(offset);
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

const hasUnreadMail = (mailbox: MailboxSwitcherMailbox) =>
  mailbox.connectionStatus === "connected" &&
  mailbox.provider !== "api" &&
  mailbox.unreadNonSpamCount > 0;

const formatUnreadCount = (count: number) =>
  count > 99 ? "99+" : String(count);

const ReorderRow = ({
  children,
  data,
  disabled,
  settle,
}: {
  children: (handleRef: Ref<HTMLButtonElement>) => ReactNode;
  data: Omit<SwitcherDragData, "moveOffset">;
  disabled: boolean;
  settle: ReorderSettle;
}) => {
  const elementRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const offset = useMotionValue(0);
  const offsetTarget = useRef(0);
  const moveOffset = (value: number | "hold") => {
    if (value === "hold") {
      offset.stop();
      offsetTarget.current = offset.get();
      return;
    }
    if (offsetTarget.current === value) {
      return;
    }
    offsetTarget.current = value;
    if (reducedMotion === true) {
      offset.jump(value);
    } else {
      animate(offset, value, reorderTransition);
    }
  };
  const dragData = { ...data, moveOffset };
  const handleRef = useRef<HTMLButtonElement>(null);
  const id = JSON.stringify([data.groupId, data.mailboxId ?? null]);
  // Start the committed order from where the row was drawn, then ease it home.
  useLayoutEffect(() => {
    const snapshot = settle.snapshot.current;
    const before = snapshot?.tops.get(id);
    const element = elementRef.current;
    if (
      !snapshot ||
      snapshot.nextOrderKey !== settle.orderKey ||
      before === undefined ||
      !element
    ) {
      return;
    }
    snapshot.tops.delete(id);
    offsetTarget.current = before - element.getBoundingClientRect().top;
    offset.jump(offsetTarget.current);
    moveOffset(0);
  });
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
    collisionDetector: ({ droppable, dragOperation }) =>
      getSwitcherCollision(droppable, dragOperation.position.current.y),
    data: dragData,
    disabled,
    element: elementRef,
    id,
    type,
  });
  const { source } = useDragOperation<SwitcherDragData>();
  return (
    <div
      className="relative rounded-md"
      data-mailbox-switcher-group={data.groupId}
      data-mailbox-switcher-mailbox={data.mailboxId}
      data-mailbox-switcher-navigation-row
      ref={elementRef}
    >
      <m.div
        aria-hidden={isDragSource ? true : undefined}
        className={cn("rounded-md", {
          "bg-muted opacity-35 ring-1 ring-border": isDragSource,
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
  <div className="flex items-center gap-1">
    <DropdownMenuItem
      nativeButton
      // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- The menu supplies the mailbox summary as button content.
      render={<button ref={handleRef} type="button" />}
      aria-current={isActive ? "page" : undefined}
      aria-describedby="mailbox-order-help"
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      className="min-w-0 flex-1 touch-pan-y"
      data-mailbox-switcher-navigation-item
      onSelect={(event) => {
        if (!event.defaultPrevented) {
          onSelect();
        }
      }}
    >
      <span aria-hidden className="flex size-4 shrink-0 items-center">
        {isActive && <Icon icon={Tick01Icon} size={14} />}
      </span>
      {children}
    </DropdownMenuItem>
    {action !== null && action !== undefined && action !== false && (
      <div className="shrink-0 pe-2.5">{action}</div>
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
    return (
      <span className="shrink-0 text-caption text-muted-fg">Send only</span>
    );
  }

  if (!hasUnreadMail(mailbox)) {
    return null;
  }

  return (
    <span className="shrink-0 text-right text-caption text-fg tabular-nums">
      <span aria-hidden>{formatUnreadCount(mailbox.unreadNonSpamCount)}</span>
      <span className="sr-only">{mailbox.unreadNonSpamCount} unread</span>
    </span>
  );
};

const MailboxSummary = ({ className, mailbox }: MailboxSummaryProps) => {
  const trimmedDisplayName = mailbox.displayName?.trim();
  const displayName =
    trimmedDisplayName === undefined || trimmedDisplayName === ""
      ? null
      : trimmedDisplayName;
  return (
    <span className={cn("flex min-h-8 min-w-0 items-center gap-2", className)}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-sm/4 text-fg">
          {displayName ?? mailbox.emailAddress}
        </span>
        {displayName !== null && (
          <span className="block truncate text-caption/4 text-muted-fg">
            {mailbox.emailAddress}
          </span>
        )}
      </span>
      {mailbox.provider === "managed" &&
        (mailbox.accessMode === "private" ||
          mailbox.accessMode === "shared") && (
          <span className="shrink-0 text-caption text-muted-fg">
            {mailbox.accessMode === "private" ? "Private" : "Shared"}
          </span>
        )}
      <MailboxInboxStatus mailbox={mailbox} />
    </span>
  );
};

const MailboxTeam = ({
  children,
  collapsed,
  disabled,
  embedded,
  group,
  index,
  settle,
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
  settle: ReorderSettle;
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
        settle={settle}
      >
        {(handleRef) => (
          <div className="flex items-center gap-1">
            <DropdownMenuItem
              closeOnSelect={false}
              nativeButton
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- The menu supplies the group name as button content.
              render={<button ref={handleRef} type="button" />}
              aria-describedby={disabled ? undefined : "mailbox-order-help"}
              aria-expanded={!closed}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              // oxlint-disable-next-line shadcn/no-restyle -- Keep the drag handle at its measured size while pressed.
              className="min-w-0 flex-1 touch-pan-y active:scale-100"
              data-mailbox-switcher-navigation-item
              onSelect={(event) => {
                if (!event.defaultPrevented) {
                  onToggle(group.id);
                }
              }}
            >
              <m.span
                animate={{ rotate: closed ? 0 : 90 }}
                className="flex size-4 shrink-0 items-center justify-center text-muted-fg"
                initial={false}
                transition={{
                  duration: reducedMotion === true ? 0 : 0.2,
                  ease: appEaseOut,
                }}
              >
                <Icon aria-hidden size={12} icon={ArrowRight01Icon} />
              </m.span>
              <span className="min-w-0 truncate text-caption text-muted-fg">
                {group.name}
              </span>
              {collapsed &&
                !sortingTeams &&
                group.mailboxes.some(hasUnreadMail) && (
                  <>
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full bg-primary"
                    />
                    <span className="sr-only">Unread mail</span>
                  </>
                )}
            </DropdownMenuItem>
            {group.kind === "organization" && !embedded && (
              <IconButtonTooltip label={`Open ${group.name} settings`}>
                <LinkButton
                  aria-label={`Open ${group.name} settings`}
                  className="mr-0.5"
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
        <div className="space-y-0.5">{children}</div>
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
  accountLabel,
  allInboxesActive = false,
  onSelectAllInboxes,
  embedded = false,
  groups,
  isLoading = false,
  onReorderMailboxSwitcher,
  onReconnectMailbox,
  onSelectMailboxId,
  reconnectingMailboxId,
  selectedMailboxId,
  side = "right",
  unifiedInboxExcludedIds,
}: MailboxSwitcherDropdownProps) => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const mailboxes = groups.flatMap((group) => group.mailboxes);
  const { primaryLabel, secondaryLabel, selectedMailbox } =
    getMailboxSwitcherSummary(mailboxes, selectedMailboxId);
  const loadingEmpty = isLoading && mailboxes.length === 0;
  const selectionLabel = allInboxesActive ? "All inboxes" : primaryLabel;
  const selectionDescription = allInboxesActive
    ? "Your selected inboxes, together"
    : secondaryLabel;
  const currentLabel = loadingEmpty
    ? (accountLabel ?? "Mailboxes")
    : selectionLabel;
  const currentSecondaryLabel = loadingEmpty
    ? "Loading mailboxes…"
    : selectionDescription;
  const preview = usePreviewPersona();
  const warmMailboxSettings = () => {
    void warmSettingsDestination({
      isSandboxMode: preview !== null,
      queryClient,
      router,
      tab: "mailboxes",
    });
  };
  const hasOtherUnread = mailboxes.some(
    (mailbox) =>
      hasUnreadMail(mailbox) &&
      (allInboxesActive
        ? unifiedInboxExcludedIds.includes(mailbox.id)
        : mailbox.id !== selectedMailbox?.id)
  );
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingTeam, setDraggingTeam] = useState(false);
  const [dragPanelHeight, setDragPanelHeight] = useState<number>();
  const listRef = useRef<HTMLDivElement>(null);
  const orderKey = JSON.stringify(getMailboxSwitcherOrder(groups));
  const reorderSnapshotRef = useRef<ReorderSnapshot | null>(null);
  const settle = { orderKey, snapshot: reorderSnapshotRef };
  useEffect(
    () => () => {
      window.clearTimeout(reorderSnapshotRef.current?.timeout);
    },
    []
  );
  useLayoutEffect(() => {
    const snapshot = reorderSnapshotRef.current;
    if (snapshot && snapshot.orderKey !== orderKey) {
      window.clearTimeout(snapshot.timeout);
      reorderSnapshotRef.current = null;
      if (snapshot.nextOrderKey !== orderKey) {
        snapshot.restore?.();
      }
    }
  });
  const reorder = (
    nextGroups: MailboxSwitcherGroup[],
    restore?: () => void
  ) => {
    const nextOrder = getMailboxSwitcherOrder(nextGroups);
    const previous = reorderSnapshotRef.current;
    window.clearTimeout(previous?.timeout);
    if (restore === undefined) {
      previous?.restore?.();
    }
    const rows =
      listRef.current?.querySelectorAll<HTMLElement>(
        "[data-mailbox-switcher-navigation-row]"
      ) ?? [];
    reorderSnapshotRef.current = {
      nextOrderKey: JSON.stringify(nextOrder),
      orderKey,
      restore,
      timeout: window.setTimeout(() => {
        reorderSnapshotRef.current = null;
        restore?.();
      }, reorderAnimation.duration),
      tops: new Map(
        [...rows]
          .filter((row) => !row.closest("[inert]"))
          .map((row): [string, number] => [
            JSON.stringify([
              row.dataset.mailboxSwitcherGroup,
              row.dataset.mailboxSwitcherMailbox ?? null,
            ]),
            (row.firstElementChild ?? row).getBoundingClientRect().top,
          ])
      ),
    };
    onReorderMailboxSwitcher(nextOrder);
  };
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
  const handleArrowNavigation = (event: ReactKeyboardEvent<HTMLElement>) => {
    const list = listRef.current;
    if (!(event.target instanceof HTMLElement) || list === null) {
      return;
    }

    const { target } = event;
    if (event.key === "/" && !(target instanceof HTMLInputElement)) {
      event.preventDefault();
      event.stopPropagation();
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
      event.stopPropagation();
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
        reorder(nextGroups);
        setOrderAnnouncement(
          `Mailbox moved to position ${toIndex + 1} of ${items.length} in ${group.name}.`
        );
      } else {
        reorder(moveItem(groups, fromIndex, toIndex));
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
        event.stopPropagation();
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
        event.stopPropagation();
        primaryItem.focus();
      }
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    const items = [
      ...list.querySelectorAll<HTMLElement>(
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
      event.stopPropagation();
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
    event.stopPropagation();
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
    const target =
      !event.canceled && source
        ? getSwitcherDropTarget(manager, source, event.nativeEvent)
        : undefined;
    const restore = () => {
      for (const row of manager.registry.droppables) {
        row.data.moveOffset(0);
      }
    };
    if (
      event.canceled ||
      !source ||
      !target ||
      source.id === target.id ||
      source.type !== target.type
    ) {
      restore();
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
    for (const row of manager.registry.droppables) {
      row.data.moveOffset("hold");
    }
    reorder(nextGroups, restore);
    setOrderAnnouncement(`${from.label} moved to position ${to.index + 1}.`);
  };

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open, details) => {
        if (!open && isDragging) {
          details.cancel();
          return;
        }
        setIsOpen(open);
        if (!open) {
          window.clearTimeout(reorderSnapshotRef.current?.timeout);
          reorderSnapshotRef.current = null;
          setDraggingTeam(false);
          setDragPanelHeight(undefined);
          setSearchQuery("");
        }
      }}
      open={isOpen}
    >
      <div className="relative min-w-0 flex-1 rounded-md hover:bg-control-hover">
        <DropdownMenuTrigger
          disabled={loadingEmpty}
          onKeyDownCapture={handleEscapeCapture}
          aria-label={`Switch mailbox, ${currentLabel}${hasOtherUnread ? ", unread mail in other mailboxes" : ""}`}
          render={<Button size="auto" variant="ghost" />}
          nativeButton
          // oxlint-disable-next-line shadcn/no-restyle -- Switcher trigger keeps its nav metrics.
          className="relative z-10 w-full min-w-0 rounded-md px-3 py-2 text-left hover:bg-transparent hover:text-fg active:scale-100"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <m.div
              key={`${selectedMailbox?.id ?? (loadingEmpty ? "loading" : "empty")}:${currentLabel}:${currentSecondaryLabel}`}
              animate={{ opacity: 1 }}
              className="min-w-0 flex-1"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              transition={{
                duration: appMotionDuration.feedback,
                ease: appEaseOut,
              }}
            >
              <p className="truncate text-body-sm/5 font-medium text-fg">
                {currentLabel}
              </p>
              <p className="mt-1 truncate text-caption text-muted-fg">
                {currentSecondaryLabel}
              </p>
            </m.div>
          </AnimatePresence>
          {hasOtherUnread && (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-primary"
            />
          )}
          <Icon aria-hidden icon={ArrowDown01Icon} tone="muted" />
        </DropdownMenuTrigger>
      </div>

      <DropdownMenuContent
        onKeyDownCapture={handleEscapeCapture}
        align="start"
        // oxlint-disable-next-line shadcn/no-restyle -- Bound the search field and mailbox list together.
        className="max-h-[min(26rem,calc(100dvh-1rem))] w-[min(20rem,calc(100vw-2rem))]"
        scroll="viewport"
        side={side}
      >
        <DragDropProvider<SwitcherDragData>
          plugins={defaultPreset.plugins.filter(
            (plugin) => plugin !== Accessibility && plugin !== Cursor
          )}
          onDragMove={(_event, manager) => {
            updateDragPreview(manager);
          }}
          onDragOver={(_event, manager) => {
            updateDragPreview(manager);
          }}
          onDragEnd={handleDragEnd}
          onDragStart={(event, manager) => {
            const previous = reorderSnapshotRef.current;
            if (previous) {
              window.clearTimeout(previous.timeout);
              reorderSnapshotRef.current = null;
              previous.restore?.();
            }
            dragManagerRef.current = manager;
            setIsDragging(true);
            setDragPanelHeight(listRef.current?.getBoundingClientRect().height);
            setDraggingTeam(event.operation.source?.type === "teams");
          }}
        >
          {groups.length > 0 && (mailboxes.length >= 8 || isFiltering) && (
            <div className="shrink-0 px-1.5 pt-1.5 pb-1">
              <Input
                aria-label="Search mailboxes"
                onChange={(event) => {
                  setSearchQuery(event.currentTarget.value);
                }}
                onKeyDown={handleArrowNavigation}
                placeholder="Search mailboxes"
                ref={searchRef}
                value={searchQuery}
              />
            </div>
          )}
          <DropdownMenuViewport
            className="flex flex-col gap-2.5"
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
                  <DropdownMenuItem
                    aria-current={allInboxesActive ? "page" : undefined}
                    data-mailbox-switcher-navigation-item
                    onSelect={onSelectAllInboxes}
                  >
                    <Icon
                      aria-hidden
                      icon={allInboxesActive ? Tick01Icon : Mail01Icon}
                    />
                    All inboxes
                  </DropdownMenuItem>
                ) : null}
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
                        settle={settle}
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
                                settle={settle}
                              >
                                {(handleRef) => (
                                  <MailboxMenuItem
                                    handleRef={handleRef}
                                    action={
                                      needsReconnect ? (
                                        <Button
                                          aria-label={`Reconnect ${mailbox.emailAddress} through Google`}
                                          data-mailbox-switcher-navigation-action
                                          disabled={isReconnecting}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            onReconnectMailbox(mailbox);
                                          }}
                                          size="xs"
                                          variant="destructive"
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
                                        </Button>
                                      ) : undefined
                                    }
                                    isActive={isActive}
                                    onSelect={() => {
                                      onSelectMailboxId(mailbox.id);
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
                          <p className="py-1 ps-8.5 text-caption text-muted-fg">
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
                  <div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onFocus={warmMailboxSettings}
                      onMouseEnter={warmMailboxSettings}
                      onPointerDown={warmMailboxSettings}
                      render={
                        <Link
                          search={{
                            from: "/",
                            mailboxId: "",
                            tab: "mailboxes",
                          }}
                          to="/settings"
                        />
                      }
                      data-mailbox-switcher-navigation-item
                    >
                      <Icon aria-hidden icon={Settings01Icon} tone="muted" />
                      <span className="text-muted-fg">Mailbox settings</span>
                    </DropdownMenuItem>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-md px-2.5 py-2 text-body text-muted-fg">
                No Mailbox
              </div>
            )}
          </DropdownMenuViewport>
          {isOpen &&
            createPortal(
              <DragOverlay<SwitcherDragData, Draggable<SwitcherDragData>>
                className="pointer-events-none z-50 rounded-md bg-popover shadow-elevation"
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
                      className="flex min-h-10 items-center py-1 ps-8.5 pe-2.5"
                    >
                      <MailboxSummary className="w-full" mailbox={mailbox} />
                    </div>
                  ) : (
                    <div
                      aria-hidden
                      className="flex min-h-7 items-center gap-2 px-2.5 py-1 text-caption text-muted-fg"
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <Icon size={12} icon={ArrowRight01Icon} />
                      </span>
                      <span className="min-w-0 truncate">{group?.name}</span>
                    </div>
                  );
                }}
              </DragOverlay>,
              document.body
            )}
        </DragDropProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
