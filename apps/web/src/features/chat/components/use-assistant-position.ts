import { animate, useMotionValue } from "motion/react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PointerEvent } from "react";
import { z } from "zod";

const edgeSchema = z.enum(["left", "right", "top", "bottom"]);
const positionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("dock") }),
  z.object({
    mode: z.literal("free"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  z.object({
    edge: edgeSchema,
    fraction: z.number().min(0).max(1),
    mode: z.literal("edge"),
  }),
]);
type Position = z.infer<typeof positionSchema>;
type Edge = z.infer<typeof edgeSchema>;
export const assistantLauncherSize = 56;

const storageKey = "quieter:assistant-position:v1";

export const useAssistantPosition = ({
  open,
  panelSize,
  reducedMotion,
}: {
  open: boolean;
  panelSize: { width: number; height: number };
  reducedMotion: boolean;
}) => {
  const boundsRef = useRef<HTMLDivElement | null>(null);
  const draggedRef = useRef(false);
  const dockRef = useRef({ available: false, x: 0, y: 0 });
  const gestureRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
    position: Position;
  } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);
  const [position, setPosition] = useState<Position>({ mode: "dock" });
  const [revealed, setRevealed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hasDock, setHasDock] = useState(false);
  const [nearDock, setNearDock] = useState(false);
  const [pendingEdge, setPendingEdge] = useState<Edge | null>(null);
  const pendingEdgeRef = useRef<Edge | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const dockX = useMotionValue(0);
  const dockY = useMotionValue(0);
  const tabX = useMotionValue(0);
  const tabY = useMotionValue(0);

  const reposition = useEffectEvent((immediate = false) => {
    const bounds = boundsRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    const width = open
      ? Math.min(panelSize.width, bounds.width)
      : assistantLauncherSize;
    const height = open
      ? Math.min(panelSize.height, bounds.height)
      : assistantLauncherSize;
    const dock = [...document.querySelectorAll("[data-assistant-dock]")]
      .map((element) => element.getBoundingClientRect())
      .find((rect) => rect.width > 0 && rect.height > 0);
    dockRef.current = {
      available: dock !== undefined,
      x: dock ? dock.right - bounds.right : 0,
      y: dock ? dock.bottom - bounds.bottom : 0,
    };
    setHasDock(dock !== undefined);
    dockX.set(dockRef.current.x);
    dockY.set(dockRef.current.y);
    if (gestureRef.current) {
      return;
    }
    let nextX = x.get();
    let nextY = y.get();
    if (position.mode === "dock") {
      nextX = dockRef.current.x + (dock ? width - assistantLauncherSize : 0);
      nextY = dockRef.current.y;
    } else if (position.mode === "free") {
      nextX = -(1 - position.x) * (bounds.width - width);
      nextY = -(1 - position.y) * (bounds.height - height);
    } else {
      const horizontal = position.edge === "top" || position.edge === "bottom";
      const tabDepth = revealed || open ? 80 : 18;
      const alongX = -(1 - position.fraction) * (bounds.width - width);
      const alongY = -(1 - position.fraction) * (bounds.height - height);
      if (horizontal) {
        nextX = alongX;
        nextY = position.edge === "top" ? height - bounds.height : 0;
        tabX.set(-(1 - position.fraction) * (bounds.width - 80));
        tabY.set(
          position.edge === "top"
            ? tabDepth - bounds.bottom
            : window.innerHeight - bounds.bottom
        );
      } else {
        nextX = position.edge === "left" ? width - bounds.width : 0;
        nextY = alongY;
        tabX.set(
          position.edge === "left"
            ? tabDepth - bounds.right
            : window.innerWidth - bounds.right
        );
        tabY.set(-(1 - position.fraction) * (bounds.height - 80));
      }
      if (!revealed && !open) {
        if (position.edge === "left") {
          nextX = -bounds.right;
        }
        if (position.edge === "right") {
          nextX = window.innerWidth - bounds.right + width;
        }
        if (position.edge === "top") {
          nextY = -bounds.bottom;
        }
        if (position.edge === "bottom") {
          nextY = window.innerHeight - bounds.bottom + height;
        }
      } else if (!open) {
        if (position.edge === "left") {
          nextX = width - bounds.right + 8;
        }
        if (position.edge === "right") {
          nextX = window.innerWidth - bounds.right - 8;
        }
        if (position.edge === "top") {
          nextY = height - bounds.bottom + 8;
        }
        if (position.edge === "bottom") {
          nextY = window.innerHeight - bounds.bottom - 8;
        }
      }
    }
    if (position.mode !== "edge" || open) {
      nextX = Math.max(width - bounds.width, Math.min(0, nextX));
      nextY = Math.max(height - bounds.height, Math.min(0, nextY));
    }
    if (immediate) {
      x.stop();
      y.stop();
      x.set(nextX);
      y.set(nextY);
    } else {
      const transition = reducedMotion
        ? { duration: 0 }
        : { damping: 38, mass: 1, stiffness: 420, type: "spring" as const };
      const edgeTransition = {
        duration: reducedMotion ? 0 : 0.22,
        ease: [0.22, 1, 0.36, 1] as const,
        type: "tween" as const,
      };
      animate(
        x,
        nextX,
        position.mode === "edge" && !open ? edgeTransition : transition
      );
      animate(
        y,
        nextY,
        position.mode === "edge" && !open ? edgeTransition : transition
      );
    }
  });

  useLayoutEffect(() => {
    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? "null"
      );
      const parsed = positionSchema.safeParse(stored);
      if (parsed.success) {
        // oxlint-disable-next-line react/set-state-in-effect -- Restore browser-only preferences before paint without changing server markup.
        setPosition(parsed.data);
      }
    } catch {
      // Position preferences are optional when browser storage is unavailable.
    }
  }, []);

  useLayoutEffect(() => {
    reposition(!initializedRef.current);
    initializedRef.current = true;
    const observer = new ResizeObserver(() => {
      reposition(true);
    });
    if (boundsRef.current) {
      observer.observe(boundsRef.current);
    }
    for (const dock of document.querySelectorAll("[data-assistant-dock]")) {
      observer.observe(dock);
    }
    const dockObserver = new MutationObserver((records) => {
      const dockChanged = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches("[data-assistant-dock]") ||
              node.querySelector("[data-assistant-dock]") !== null)
        )
      );
      if (dockChanged) {
        for (const dock of document.querySelectorAll("[data-assistant-dock]")) {
          observer.observe(dock);
        }
        reposition(true);
      }
    });
    dockObserver.observe(document.body, { childList: true, subtree: true });
    const onResize = () => {
      reposition(true);
    };
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      dockObserver.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useLayoutEffect(() => {
    reposition();
  }, [open, panelSize, position, reducedMotion, revealed]);

  useEffect(
    () => () => {
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
      }
      x.stop();
      y.stop();
    },
    [x, y]
  );

  const reveal = () => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
    }
    setRevealed(true);
  };
  const tuck = () => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => {
      if (
        !gestureRef.current &&
        !document.activeElement?.closest(
          "[data-assistant-surface], [data-assistant-edge-tab]"
        )
      ) {
        setRevealed(false);
      }
    }, 180);
  };

  const startDrag = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || gestureRef.current) {
      return;
    }
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
    }
    draggedRef.current = false;
    pendingEdgeRef.current = null;
    x.stop();
    y.stop();
    gestureRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      position,
      x: x.get(),
      y: y.get(),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    const bounds = boundsRef.current?.getBoundingClientRect();
    if (!gesture || gesture.pointerId !== event.pointerId || !bounds) {
      return;
    }
    let deltaX = event.clientX - gesture.clientX;
    let deltaY = event.clientY - gesture.clientY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 5 && !draggedRef.current) {
      return;
    }
    draggedRef.current = true;
    setDragging(true);
    if (
      gesture.position.mode === "dock" &&
      dockRef.current.available &&
      distance > 0
    ) {
      const resistedDistance =
        distance <= 28 ? distance * 0.28 : distance - 28 * (1 - 0.28);
      deltaX *= resistedDistance / distance;
      deltaY *= resistedDistance / distance;
    }
    const width = open
      ? Math.min(panelSize.width, bounds.width)
      : assistantLauncherSize;
    const height = open
      ? Math.min(panelSize.height, bounds.height)
      : assistantLauncherSize;
    const targetX = Math.max(
      width - bounds.width,
      Math.min(0, dockRef.current.x + width - assistantLauncherSize)
    );
    const targetY = Math.max(
      height - bounds.height,
      Math.min(0, dockRef.current.y)
    );
    let nextX = Math.max(
      width - bounds.right,
      Math.min(window.innerWidth - bounds.right, gesture.x + deltaX)
    );
    let nextY = Math.max(
      height - bounds.bottom,
      Math.min(window.innerHeight - bounds.bottom, gesture.y + deltaY)
    );
    const dockDistance = Math.hypot(nextX - targetX, nextY - targetY);
    const canDock = dockRef.current.available && dockDistance < 56;
    setNearDock(canDock);
    if (canDock && !(gesture.position.mode === "dock" && distance <= 80)) {
      const attraction = (1 - dockDistance / 56) * 0.65;
      nextX += (targetX - nextX) * attraction;
      nextY += (targetY - nextY) * attraction;
    }
    const edges: { edge: Edge; distance: number }[] = [
      { distance: bounds.right - width + nextX, edge: "left" },
      { distance: window.innerWidth - bounds.right - nextX, edge: "right" },
      { distance: bounds.bottom - height + nextY, edge: "top" },
      { distance: window.innerHeight - bounds.bottom - nextY, edge: "bottom" },
    ];
    const [closest] = edges.toSorted((a, b) => a.distance - b.distance);
    pendingEdgeRef.current =
      !open && !canDock && closest.distance < 14 ? closest.edge : null;
    setPendingEdge(pendingEdgeRef.current);
    x.set(nextX);
    y.set(nextY);
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    const bounds = boundsRef.current?.getBoundingClientRect();
    if (!gesture || gesture.pointerId !== event.pointerId || !bounds) {
      return;
    }
    gestureRef.current = null;
    setDragging(false);
    setNearDock(false);
    setPendingEdge(null);
    if (!draggedRef.current) {
      return;
    }
    if (event.type !== "pointerup") {
      const transition = reducedMotion
        ? { duration: 0 }
        : { damping: 38, stiffness: 420, type: "spring" as const };
      animate(x, gesture.x, transition);
      animate(y, gesture.y, transition);
      return;
    }
    const width = open
      ? Math.min(panelSize.width, bounds.width)
      : assistantLauncherSize;
    const height = open
      ? Math.min(panelSize.height, bounds.height)
      : assistantLauncherSize;
    const targetX = Math.max(
      width - bounds.width,
      Math.min(0, dockRef.current.x + width - assistantLauncherSize)
    );
    const targetY = Math.max(
      height - bounds.height,
      Math.min(0, dockRef.current.y)
    );
    const normalizedX = Math.max(
      0,
      Math.min(
        1,
        (bounds.width - width + x.get()) / Math.max(1, bounds.width - width)
      )
    );
    const normalizedY = Math.max(
      0,
      Math.min(
        1,
        (bounds.height - height + y.get()) / Math.max(1, bounds.height - height)
      )
    );
    let next: Position = { mode: "free", x: normalizedX, y: normalizedY };
    if (
      dockRef.current.available &&
      Math.hypot(x.get() - targetX, y.get() - targetY) < 56
    ) {
      next = { mode: "dock" };
    } else if (pendingEdgeRef.current) {
      next = {
        edge: pendingEdgeRef.current,
        fraction:
          pendingEdgeRef.current === "top" ||
          pendingEdgeRef.current === "bottom"
            ? normalizedX
            : normalizedY,
        mode: "edge",
      };
    }
    setPosition(next);
    pendingEdgeRef.current = null;
    setRevealed(false);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Dragging remains available without persistent browser storage.
    }
  };

  return {
    boundsRef,
    dockX,
    dockY,
    draggedRef,
    dragging,
    edge: position.mode === "edge" ? position.edge : null,
    endDrag,
    hasDock,
    moveDrag,
    nearDock,
    pendingEdge,
    reveal,
    startDrag,
    tabX,
    tabY,
    tuck,
    tucked: position.mode === "edge" && !revealed && !open && !dragging,
    x,
    y,
  };
};
