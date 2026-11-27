"use client";

import { CollisionPriority, CollisionType, configure } from "@dnd-kit/abstract";
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers";
import {
  Accessibility,
  Cursor,
  Feedback,
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
  defaultPreset,
} from "@dnd-kit/dom";
import {
  DragDropProvider,
  useDragOperation,
  useDraggable,
  useDroppable,
} from "@dnd-kit/react";
import type { DragDropEventHandlers } from "@dnd-kit/react";
import { GripVerticalIcon } from "@hugeicons/core-free-icons";
import {
  appEaseOut,
  appMotionDuration,
} from "@quieter/app/features/motion/app-motion";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { LayoutGroup, MotionConfig, m } from "motion/react";
import { useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";

import { MailboxLabelSwatch } from "./mailbox-label-swatch";

type RowEdge = { edge: "before" | "after"; id: string };
type LabelDestination =
  | { kind: "destination"; groupId: string | null; target?: RowEdge }
  | { kind: "group-destination"; target: RowEdge };
type DraggableLabelItem = {
  kind: "label" | "group";
  id: string;
  name: string;
  color: MailboxLabelColor | null;
};
type LabelDropZone = LabelDestination & {
  containsPoint: (x: number, y: number) => boolean;
};
type LabelDragData = DraggableLabelItem | LabelDropZone;

const labelSensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ tolerance: 8, value: 220 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
  KeyboardSensor.configure({ offset: { x: 0, y: 18 } }),
];

const labelPlugins = [
  ...defaultPreset.plugins.filter(
    (plugin) =>
      plugin !== Cursor && plugin !== Feedback && plugin !== Accessibility
  ),
  configure(Accessibility, {
    announcements: {
      dragend: ({ canceled, operation }) => {
        const name: unknown = operation.source?.data.name;
        const label = typeof name === "string" ? name : "label";
        return canceled ? `Canceled move for ${label}.` : `Dropped ${label}.`;
      },
      dragstart: ({ operation }) => {
        const name: unknown = operation.source?.data.name;
        return typeof name === "string" ? `Picked up ${name}.` : undefined;
      },
    },
  }),
  Feedback.configure({
    // Layout animation owns row movement. Feedback still restores keyboard focus.
    dropAnimation: { duration: 0 },
    feedback: "move",
  }),
];
const labelModifiers = [RestrictToVerticalAxis];

const layoutTransition = {
  layout: { duration: appMotionDuration.feedback, ease: appEaseOut },
};

export const LabelDragProvider = ({
  children,
  onMove,
  onMoveGroup,
}: {
  children: ReactNode;
  onMove: (
    labelId: string,
    groupId: string | null,
    target?: RowEdge
  ) => Promise<void>;
  onMoveGroup: (groupId: string, target: RowEdge) => Promise<void>;
}) => {
  const onDragEnd: DragDropEventHandlers<LabelDragData>["onDragEnd"] = (
    event,
    manager
  ) => {
    const { source } = event.operation;
    if (source?.data.kind !== "label" && source?.data.kind !== "group") {
      return;
    }

    const { nativeEvent } = event;
    // The pointer sensor can finish before the last queued movement is processed.
    let destination: LabelDragData | undefined;
    if (!event.canceled && nativeEvent instanceof PointerEvent) {
      destination = [...manager.registry.droppables].find(
        (dropZone) =>
          !dropZone.disabled &&
          dropZone.accepts(source) &&
          (dropZone.data.kind === "destination" ||
            dropZone.data.kind === "group-destination") &&
          dropZone.data.containsPoint(nativeEvent.clientX, nativeEvent.clientY)
      )?.data;
    } else if (!event.canceled) {
      const collision = manager.collisionObserver.computeCollisions().at(0);
      destination = collision
        ? manager.registry.droppables.get(collision.id)?.data
        : undefined;
    }
    const item = source.data;
    const completeDrop = async () => {
      if (destination?.kind === "destination" && item.kind === "label") {
        await onMove(item.id, destination.groupId, destination.target);
      } else if (
        destination?.kind === "group-destination" &&
        item.kind === "group"
      ) {
        await onMoveGroup(item.id, destination.target);
      }
      if (nativeEvent instanceof KeyboardEvent) {
        requestAnimationFrame(() => {
          if (document.activeElement === document.body) {
            const handle = manager.registry.draggables.get(source.id)?.handle;
            if (handle instanceof HTMLElement) {
              handle.focus({ preventScroll: true });
            }
          }
        });
      }
    };
    void completeDrop();
  };

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <DragDropProvider<LabelDragData>
          modifiers={labelModifiers}
          onDragEnd={onDragEnd}
          plugins={labelPlugins}
          sensors={labelSensors}
        >
          {children}
        </DragDropProvider>
      </LayoutGroup>
    </MotionConfig>
  );
};

const useLabelDropZone = ({
  destination,
  disabled,
  element,
  splitRow = false,
}: {
  destination: LabelDestination;
  disabled: boolean;
  element: RefObject<HTMLElement | null>;
  splitRow?: boolean;
}) => {
  const id = useId();
  const previewRef = useRef<HTMLLIElement>(null);
  const containsPoint = (x: number, y: number) => {
    const row = element.current;
    const bounds = row?.closest("[data-labels-list]")?.getBoundingClientRect();
    if (
      !row ||
      !bounds ||
      x < bounds.left ||
      x >= bounds.right ||
      y < bounds.top ||
      y >= bounds.bottom
    ) {
      return false;
    }

    const rect = row.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const top =
      splitRow && destination.target?.edge === "after" ? midpoint : rect.top;
    const end =
      destination.kind === "destination" &&
      destination.groupId === null &&
      !splitRow
        ? bounds.bottom
        : rect.bottom;
    const bottom =
      splitRow && destination.target?.edge === "before" ? midpoint : end;
    // Keep the same destination when reflow moves the preview under the pointer.
    const preview = previewRef.current?.getBoundingClientRect();
    const withinPreview =
      preview !== undefined &&
      x >= preview.left &&
      x < preview.right &&
      y >= preview.top &&
      y < preview.bottom;
    return (
      withinPreview ||
      (x >= rect.left && x < rect.right && y >= top && y < bottom)
    );
  };
  const itemKind = destination.kind === "group-destination" ? "group" : "label";
  const { isDropTarget } = useDroppable<LabelDragData>({
    accept: (source) =>
      source.data.kind === itemKind &&
      source.data.id !== destination.target?.id,
    collisionDetector: ({ dragOperation }) => {
      const { x, y } = dragOperation.position.current;
      if (!containsPoint(x, y)) {
        return null;
      }

      return {
        id,
        priority: CollisionPriority.Normal,
        type: CollisionType.PointerIntersection,
        value: 1,
      };
    },
    data: { ...destination, containsPoint },
    disabled,
    element,
    id,
  });
  const { source } = useDragOperation<LabelDragData>();
  const item = source?.data;
  const dragging = item?.kind === itemKind;
  return {
    dragging,
    preview: isDropTarget && dragging ? item : null,
    previewRef,
  };
};

const LabelDropPreview = ({
  grouped,
  preview,
  previewRef,
}: {
  grouped: boolean;
  preview: DraggableLabelItem | null;
  previewRef: RefObject<HTMLLIElement | null>;
}) =>
  preview ? (
    <li
      aria-hidden
      className="pointer-events-none rounded-lg bg-selection/50 ps-8 pe-2 text-body-sm text-muted-fg"
      data-label-drop-preview=""
      ref={previewRef}
    >
      <div className="flex min-h-9 items-center gap-1.5">
        <span className="me-0.5 w-3 shrink-0" />
        {grouped ? <span className="w-5 shrink-0" /> : null}
        <span className="flex w-5 shrink-0 justify-center">
          <MailboxLabelSwatch color={preview.color} kind={preview.kind} />
        </span>
        <span className="min-w-0 truncate ps-2.25">{preview.name}</span>
      </div>
    </li>
  ) : null;

type SortableRowParts = {
  handle: ReactNode;
  headerRef: RefObject<HTMLDivElement | null>;
  isDragSource: boolean;
};

const SortableLabelRow = ({
  children,
  disabled,
  groupId,
  item,
}: {
  children: (parts: SortableRowParts) => ReactNode;
  disabled: boolean;
  groupId: string | null;
  item: DraggableLabelItem;
}) => {
  const element = useRef<HTMLLIElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const { handleRef, isDragSource } = useDraggable<LabelDragData>({
    data: item,
    disabled,
    element: item.kind === "group" ? headerRef : element,
    id: `${item.kind}:${item.id}`,
  });
  const beforeTarget = { edge: "before", id: item.id } as const;
  const afterTarget = { edge: "after", id: item.id } as const;
  const before = useLabelDropZone({
    destination:
      item.kind === "group"
        ? { kind: "group-destination", target: beforeTarget }
        : { groupId, kind: "destination", target: beforeTarget },
    disabled,
    element,
    splitRow: true,
  });
  const after = useLabelDropZone({
    destination:
      item.kind === "group"
        ? { kind: "group-destination", target: afterTarget }
        : { groupId, kind: "destination", target: afterTarget },
    disabled,
    element,
    splitRow: true,
  });
  const handle = (
    <IconButtonTooltip label={`Drag ${item.name}`}>
      <Button
        aria-label={`Drag ${item.name}`}
        className="shrink-0 touch-none"
        disabled={disabled}
        focusableWhenDisabled
        ref={handleRef}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Icon aria-hidden icon={GripVerticalIcon} tone="muted" />
      </Button>
    </IconButtonTooltip>
  );

  return (
    <>
      <LabelDropPreview
        grouped={groupId !== null}
        preview={before.preview}
        previewRef={before.previewRef}
      />
      <li ref={element}>{children({ handle, headerRef, isDragSource })}</li>
      <LabelDropPreview
        grouped={groupId !== null}
        preview={after.preview}
        previewRef={after.previewRef}
      />
    </>
  );
};

export const LabelDragRow = ({
  children,
  className,
  color,
  disabled,
  groupId,
  labelId,
  name,
}: {
  children: ReactNode;
  className?: string;
  color: MailboxLabelColor | null;
  disabled: boolean;
  groupId: string | null;
  labelId: string;
  name: string;
}) => (
  <SortableLabelRow
    disabled={disabled}
    groupId={groupId}
    item={{ color, id: labelId, kind: "label", name }}
  >
    {({ handle, isDragSource }) => (
      <m.div
        className={cn(className, { "bg-section shadow-sm": isDragSource })}
        layout={isDragSource ? false : "position"}
        transition={layoutTransition}
      >
        <span className="flex w-4 shrink-0 justify-center">{handle}</span>
        {children}
      </m.div>
    )}
  </SortableLabelRow>
);

export const LabelGroupDragRow = ({
  children,
  color,
  disabled,
  groupId,
  name,
}: {
  children: (parts: SortableRowParts) => ReactNode;
  color: MailboxLabelColor;
  disabled: boolean;
  groupId: string;
  name: string;
}) => (
  <SortableLabelRow
    disabled={disabled}
    groupId={null}
    item={{ color, id: groupId, kind: "group", name }}
  >
    {children}
  </SortableLabelRow>
);

export const LabelDropTarget = ({
  children,
  className,
  disabled,
  groupId,
  target,
}: {
  children: ReactNode;
  className?: string;
  disabled: boolean;
  groupId: string | null;
  target?: RowEdge;
}) => {
  const element = useRef<HTMLDivElement>(null);
  const { dragging, preview, previewRef } = useLabelDropZone({
    destination: { groupId, kind: "destination", target },
    disabled,
    element,
  });

  if (groupId === null) {
    if (!dragging) {
      return null;
    }
    return (
      <div className="relative" ref={element}>
        {preview === null ? (
          <div
            className={cn(
              className,
              "pointer-events-none absolute inset-x-0 top-0"
            )}
          >
            {children}
          </div>
        ) : (
          <ul>
            <LabelDropPreview
              grouped={false}
              preview={preview}
              previewRef={previewRef}
            />
          </ul>
        )}
      </div>
    );
  }

  return (
    <>
      <div ref={element}>
        <m.div
          className={className}
          layout="position"
          transition={layoutTransition}
        >
          {children}
        </m.div>
      </div>
      {preview ? (
        <ul>
          <LabelDropPreview grouped preview={preview} previewRef={previewRef} />
        </ul>
      ) : null}
    </>
  );
};
