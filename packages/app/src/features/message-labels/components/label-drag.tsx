"use client";

import { CollisionPriority, CollisionType } from "@dnd-kit/abstract";
import type { CollisionDetector } from "@dnd-kit/abstract";
import {
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import type { DragDropEventHandlers } from "@dnd-kit/react";
import { Drag01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { useId } from "react";
import type { ReactNode } from "react";

const LABEL_DRAG_TYPE = "mailbox-label";

type LabelEdge = { edge: "before" | "after"; id: string };
type LabelDragData =
  | { kind: "label"; labelId: string }
  | { kind: "destination"; groupId: string | null; target?: LabelEdge };

const labelSensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === "touch"
        ? [new PointerActivationConstraints.Delay({ tolerance: 8, value: 220 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
  }),
  KeyboardSensor,
];

const collideWithLabelTarget: CollisionDetector = ({
  dragOperation,
  droppable,
}) => {
  const element = "element" in droppable ? droppable.element : null;
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const { x, y } = dragOperation.position.current;
  const { bottom, left, right, top } = element.getBoundingClientRect();
  if (x < left || x >= right || y < top || y >= bottom) {
    return null;
  }

  return {
    id: droppable.id,
    priority: CollisionPriority.Normal,
    type: CollisionType.PointerIntersection,
    value: 1,
  };
};

export const LabelDragProvider = ({
  children,
  onMove,
}: {
  children: ReactNode;
  onMove: (labelId: string, groupId: string | null, target?: LabelEdge) => void;
}) => {
  const onDragEnd: DragDropEventHandlers<LabelDragData>["onDragEnd"] = (
    event,
    manager
  ) => {
    const { source } = event.operation;
    if (event.canceled || source?.data.kind !== "label") {
      return;
    }

    const collision = manager.collisionObserver.computeCollisions().at(0);
    const destination = collision
      ? manager.registry.droppables.get(collision.id)?.data
      : undefined;
    if (destination?.kind === "destination") {
      onMove(source.data.labelId, destination.groupId, destination.target);
    }
  };

  return (
    <DragDropProvider<LabelDragData>
      onDragEnd={onDragEnd}
      sensors={labelSensors}
    >
      {children}
    </DragDropProvider>
  );
};

const LabelRowEdge = ({
  disabled,
  edge,
  groupId,
  labelId,
  sourceId,
}: {
  disabled: boolean;
  edge: LabelEdge["edge"];
  groupId: string | null;
  labelId: string;
  sourceId: string;
}) => {
  const id = useId();
  const { isDropTarget, ref } = useDroppable<LabelDragData>({
    accept: (source) =>
      source.type === LABEL_DRAG_TYPE && source.id !== sourceId,
    collisionDetector: collideWithLabelTarget,
    data: { groupId, kind: "destination", target: { edge, id: labelId } },
    disabled,
    id,
  });

  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-x-0 z-10 h-1/2", {
        "border-b border-primary/50": isDropTarget && edge === "after",
        "border-t border-primary/50": isDropTarget && edge === "before",
        "bottom-0": edge === "after",
        "top-0": edge === "before",
      })}
      ref={ref}
    />
  );
};

export const LabelDragRow = ({
  children,
  className,
  disabled,
  groupId,
  labelId,
  name,
}: {
  children: ReactNode;
  className?: string;
  disabled: boolean;
  groupId: string | null;
  labelId: string;
  name: string;
}) => {
  const id = useId();
  const { handleRef, isDragSource, ref } = useDraggable<LabelDragData>({
    data: { kind: "label", labelId },
    disabled,
    id,
    type: LABEL_DRAG_TYPE,
  });

  return (
    <li
      className={cn("group/row relative", className, {
        "bg-section": isDragSource,
      })}
      ref={ref}
    >
      <span className="flex w-6 shrink-0 justify-center opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 has-focus-visible:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100">
        <IconButtonTooltip label={`Drag ${name}`}>
          <Button
            aria-label={`Drag ${name}`}
            className="shrink-0 cursor-grab touch-none active:cursor-grabbing"
            disabled={disabled}
            ref={handleRef}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden icon={Drag01Icon} />
          </Button>
        </IconButtonTooltip>
      </span>
      {children}
      <LabelRowEdge
        disabled={disabled}
        edge="before"
        groupId={groupId}
        labelId={labelId}
        sourceId={id}
      />
      <LabelRowEdge
        disabled={disabled}
        edge="after"
        groupId={groupId}
        labelId={labelId}
        sourceId={id}
      />
    </li>
  );
};

export const LabelDropTarget = ({
  children,
  className,
  disabled,
  groupId,
}: {
  children: ReactNode;
  className?: string;
  disabled: boolean;
  groupId: string | null;
}) => {
  const id = useId();
  const { isDropTarget, ref } = useDroppable<LabelDragData>({
    accept: LABEL_DRAG_TYPE,
    collisionDetector: collideWithLabelTarget,
    data: { groupId, kind: "destination" },
    disabled,
    id,
  });

  return (
    <div className={cn(className, { "bg-selection": isDropTarget })} ref={ref}>
      {children}
    </div>
  );
};
