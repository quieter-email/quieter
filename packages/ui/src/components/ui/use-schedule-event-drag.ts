import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";

import { formatTimeMinute } from "../../lib/date-time";
import type { ScheduleItem, ScheduleProps } from "./schedule";

type DropTarget = {
  allDay: boolean;
  date: string;
  minute: number;
  zone: HTMLElement;
};

type EventDrag = {
  item: ScheduleItem;
  offsetMinute: number;
  originX: number;
  originY: number;
  pointerId: number;
  source: HTMLButtonElement;
} & (
  | { phase: "pending" }
  | {
      frame: number | null;
      ghost: HTMLButtonElement;
      grabX: number;
      grabY: number;
      marker: HTMLDivElement;
      phase: "dragging";
      target: DropTarget | null;
      x: number;
      y: number;
    }
);

export const useScheduleEventDrag = ({
  hourHeight,
  onEventMove,
  rangeKey,
  scrollRef,
  timeFormat,
}: {
  hourHeight: number;
  onEventMove: ScheduleProps["onEventMove"];
  rangeKey: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  timeFormat: "12h" | "24h";
}) => {
  const dragRef = useRef<EventDrag | null>(null);
  const suppressClickRef = useRef(false);

  const cleanup = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    dragRef.current = null;
    if (drag.phase === "dragging") {
      if (drag.frame !== null) {
        window.cancelAnimationFrame(drag.frame);
      }
      drag.ghost.remove();
      drag.marker.remove();
      delete drag.target?.zone.dataset.scheduleDropActive;
      delete drag.source.dataset.dragging;
    }
    if (drag.source.hasPointerCapture(drag.pointerId)) {
      drag.source.releasePointerCapture(drag.pointerId);
    }
  }, []);

  const cancel = useCallback(() => {
    if (dragRef.current) {
      suppressClickRef.current = true;
      cleanup();
    }
  }, [cleanup]);

  const paint = (frameTime?: number) => {
    const drag = dragRef.current;
    const scroller = scrollRef.current;
    if (drag?.phase !== "dragging" || !scroller) {
      return;
    }
    drag.frame = null;
    const viewport = scroller.getBoundingClientRect();
    const scrollDelta =
      drag.y < viewport.top + 40
        ? -Math.min(12, (viewport.top + 40 - drag.y) / 3)
        : Math.min(12, Math.max(0, (drag.y - viewport.bottom + 40) / 3));
    const previousScroll = scroller.scrollTop;
    if (
      frameTime !== undefined &&
      scrollDelta !== 0 &&
      drag.x >= viewport.left &&
      drag.x <= viewport.right
    ) {
      scroller.scrollTop += scrollDelta;
    }

    const zone = document
      .elementFromPoint(drag.x, drag.y)
      ?.closest<HTMLElement>("[data-schedule-drop-date]");
    let target: DropTarget | null = null;
    if (zone && scroller.contains(zone) && zone.dataset.scheduleDropDate) {
      const kind = zone.dataset.scheduleDropKind;
      const allDay =
        kind === "all-day" || (kind === "date" && drag.item.allDay);
      const minute =
        kind === "time"
          ? Math.max(
              0,
              Math.min(
                1425,
                Math.round(
                  (((drag.y - zone.getBoundingClientRect().top) * 60) /
                    hourHeight -
                    drag.offsetMinute) /
                    15
                ) * 15
              )
            )
          : drag.item.startMinute;
      if (kind === "time" || kind === "all-day" || kind === "date") {
        target = {
          allDay,
          date: zone.dataset.scheduleDropDate,
          minute: allDay ? 0 : minute,
          zone,
        };
      }
    }
    if (drag.target?.zone !== target?.zone) {
      delete drag.target?.zone.dataset.scheduleDropActive;
      if (target) {
        target.zone.dataset.scheduleDropActive = "";
      }
    }
    drag.target = target;
    if (target?.zone.dataset.scheduleDropKind === "time") {
      if (drag.marker.parentElement !== target.zone) {
        target.zone.append(drag.marker);
      }
      drag.marker.hidden = false;
      drag.marker.style.transform = `translateY(${(target.minute * hourHeight) / 60}px)`;
      if (drag.marker.firstElementChild) {
        const label = formatTimeMinute(target.minute, timeFormat);
        if (drag.marker.firstElementChild.textContent !== label) {
          drag.marker.firstElementChild.textContent = label;
        }
      }
    } else {
      drag.marker.hidden = true;
    }
    drag.ghost.style.transform = `translate3d(${drag.x - drag.grabX}px,${drag.y - drag.grabY}px,0)`;
    if (scroller.scrollTop !== previousScroll) {
      drag.frame = window.requestAnimationFrame(paint);
    }
  };

  const handleScroll = useEffectEvent(() => {
    const drag = dragRef.current;
    if (drag?.phase === "dragging") {
      drag.frame ??= window.requestAnimationFrame(paint);
    }
  });

  const handleLostCapture = useEffectEvent((event: globalThis.PointerEvent) => {
    const drag = dragRef.current;
    if (
      drag?.pointerId === event.pointerId &&
      !drag.source.hasPointerCapture(event.pointerId)
    ) {
      cancel();
    }
  });

  useEffect(() => {
    const scroller = scrollRef.current;
    scroller?.addEventListener("scroll", handleScroll, { passive: true });
    document.addEventListener("lostpointercapture", handleLostCapture, {
      capture: true,
      passive: true,
    });
    window.addEventListener("blur", cancel);
    return () => {
      scroller?.removeEventListener("scroll", handleScroll);
      document.removeEventListener(
        "lostpointercapture",
        handleLostCapture,
        true
      );
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [cancel, rangeKey, scrollRef]);

  return {
    activeRef: dragRef,
    consumeClick: () => {
      const suppressed = suppressClickRef.current;
      suppressClickRef.current = false;
      return suppressed;
    },
    handleCancel: cancel,
    handleKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape" && dragRef.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    },
    handlePointerDown: (
      event: PointerEvent<HTMLButtonElement>,
      item: ScheduleItem,
      timed: boolean
    ) => {
      suppressClickRef.current = false;
      if (
        !onEventMove ||
        item.preview ||
        event.button !== 0 ||
        !event.isPrimary ||
        event.pointerType === "touch"
      ) {
        return;
      }
      cleanup();
      event.preventDefault();
      const source = event.currentTarget;
      const bounds = source.getBoundingClientRect();
      source.focus({ preventScroll: true });
      source.setPointerCapture(event.pointerId);
      dragRef.current = {
        item,
        offsetMinute: timed
          ? Math.max(0, ((event.clientY - bounds.top) * 60) / hourHeight)
          : 0,
        originX: event.clientX,
        originY: event.clientY,
        phase: "pending",
        pointerId: event.pointerId,
        source,
      };
    },
    handlePointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      let drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      if (drag.phase === "pending") {
        if (
          Math.hypot(
            event.clientX - drag.originX,
            event.clientY - drag.originY
          ) < 4
        ) {
          return;
        }
        const bounds = drag.source.getBoundingClientRect();
        const ghost = drag.source.cloneNode(true);
        if (!(ghost instanceof HTMLButtonElement)) {
          return;
        }
        ghost.setAttribute("aria-hidden", "true");
        ghost.inert = true;
        ghost.tabIndex = -1;
        ghost.dataset.selected = "true";
        ghost.dataset.scheduleDragPreview = "";
        ghost.classList.add(
          "pointer-events-none",
          "opacity-90",
          "shadow-elevation"
        );
        // The preview follows measured pointer geometry without changing the schedule layout.
        Object.assign(ghost.style, {
          height: `${bounds.height}px`,
          left: "0",
          margin: "0",
          pointerEvents: "none",
          position: "fixed",
          top: "0",
          transform: `translate3d(${bounds.left}px,${bounds.top}px,0)`,
          transition: "none",
          width: `${bounds.width}px`,
          zIndex: "50",
        });
        const marker = document.createElement("div");
        marker.setAttribute("aria-hidden", "true");
        marker.className =
          "pointer-events-none absolute inset-x-0 top-0 z-30 border-t border-primary";
        const label = document.createElement("span");
        label.className =
          "rounded-sm bg-primary px-1 text-micro text-primary-fg";
        marker.append(label);
        document.body.append(ghost);
        drag.source.dataset.dragging = "";
        drag = {
          ...drag,
          frame: null,
          ghost,
          grabX: drag.originX - bounds.left,
          grabY: drag.originY - bounds.top,
          marker,
          phase: "dragging",
          target: null,
          x: event.clientX,
          y: event.clientY,
        };
        dragRef.current = drag;
      }
      event.preventDefault();
      dragRef.current = {
        ...drag,
        frame: drag.frame ?? window.requestAnimationFrame(paint),
        x: event.clientX,
        y: event.clientY,
      };
    },
    handlePointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) {
        return;
      }
      if (drag.phase === "dragging") {
        if (drag.frame !== null) {
          window.cancelAnimationFrame(drag.frame);
        }
        dragRef.current = {
          ...drag,
          frame: null,
          x: event.clientX,
          y: event.clientY,
        };
        paint();
      }
      const settled = dragRef.current;
      const target = settled?.phase === "dragging" ? settled.target : null;
      suppressClickRef.current = drag.phase === "dragging";
      cleanup();
      if (
        target &&
        (target.allDay !== drag.item.allDay ||
          target.date !== drag.item.date ||
          target.minute !== drag.item.startMinute)
      ) {
        onEventMove?.({
          allDay: target.allDay,
          date: target.date,
          id: drag.item.id,
          minute: target.minute,
          source: { date: drag.item.date, minute: drag.item.startMinute },
        });
      }
    },
  };
};
