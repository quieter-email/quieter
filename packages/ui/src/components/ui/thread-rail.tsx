"use client";

import {
  domAnimation,
  LazyMotion,
  m,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import type { MotionValue } from "motion/react";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { Text } from "./text";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export type ThreadRailItem = {
  id: string;
  label: string;
  description?: string;
  meta?: string;
};

type ThreadRailProps = {
  "aria-label": string;
  items: readonly ThreadRailItem[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  maxHeight?: number;
  className?: string;
};

type Preview =
  | { kind: "idle"; id: string | null }
  | { kind: "pointer" | "focus"; id: string };

type CaptureState = "free" | "captured";

type RailMotion = {
  cursorIndex: MotionValue<number>;
  approach: MotionValue<number>;
  capture: MotionValue<CaptureState>;
  pitch: MotionValue<number>;
};

const RailMark = ({
  active,
  index,
  motion,
  reducedMotion,
}: {
  active: boolean;
  index: number;
  motion: RailMotion;
  reducedMotion: boolean;
}) => {
  const target = useTransform(() => {
    const distance =
      ((index - motion.cursorIndex.get()) * motion.pitch.get()) / 10;
    const broad = 1 / (1 + (distance / 6) ** 2);
    const near = Math.exp(-(distance ** 2) / 5);
    return (
      1 +
      broad * motion.approach.get() * 1.6 +
      near * (motion.capture.get() === "captured" ? 2.35 : 0)
    );
  });
  const scale = useSpring(target, { damping: 26, mass: 0.5, stiffness: 600 });
  const transform = useTransform(scale, (value) => `scaleX(${value})`);
  const opacity = useTransform(scale, (value) =>
    Math.max(active ? 0.65 : 0.22, Math.min(1, 0.22 + (value - 1) * 0.24))
  );

  return (
    <m.span
      aria-hidden
      className="pointer-events-none block h-1/5 max-h-0.5 w-1.5 origin-left bg-fg motion-reduce:transform-none!"
      data-thread-rail-mark
      // oxlint-disable-next-line shadcn/no-inline-styles -- MotionValues update each mark without React renders or inherited per-frame CSS variables.
      style={{ opacity, transform: reducedMotion ? "scaleX(1)" : transform }}
    />
  );
};

export const ThreadRail = ({
  "aria-label": label,
  activeId,
  className,
  items,
  maxHeight,
  onSelect,
}: ThreadRailProps) => {
  const reducedMotion = useReducedMotion() === true;
  const railId = useId();
  const cursorIndex = useMotionValue(0);
  const approach = useMotionValue(0);
  const capture = useMotionValue<CaptureState>("free");
  const pitch = useMotionValue(10);
  const [preview, setPreview] = useState<Preview>({ id: null, kind: "idle" });
  const dismissed = useRef(false);
  const railRef = useRef<HTMLElement>(null);
  const buttons = useRef(new Map<string, HTMLElement>());
  const readItems = useEffectEvent(() => items);
  const itemCount = items.length;
  const previewIndex = items.findIndex((item) => item.id === preview.id);
  const previewItem = items[previewIndex];
  const tabStopId =
    preview.kind === "focus" && items.some((item) => item.id === preview.id)
      ? preview.id
      : (items.find((item) => item.id === activeId)?.id ?? items[0]?.id);

  useEffect((): (() => void) | undefined => {
    const rail = railRef.current;
    if (rail === null) {
      return undefined;
    }
    const document = rail.ownerDocument;
    const view = document.defaultView;
    if (view === null) {
      return undefined;
    }

    const finePointer = view.matchMedia("(hover: hover) and (pointer: fine)");
    const reset = () => {
      approach.set(0);
      capture.set("free");
      dismissed.current = false;
      setPreview((current) =>
        current.kind === "pointer" ? { ...current, kind: "idle" } : current
      );
    };
    const handlePointerMove = (event: PointerEvent) => {
      const pointerItems = readItems();
      if (event.pointerType === "touch" || !finePointer.matches) {
        reset();
        return;
      }
      const bounds = rail.getBoundingClientRect();
      if (bounds.height === 0) {
        reset();
        return;
      }

      const x = Math.abs(event.clientX - bounds.left);
      pitch.set(bounds.height / pointerItems.length);
      const position =
        ((event.clientY - bounds.top) / bounds.height) * pointerItems.length -
        0.5;
      const captureDistance = Math.hypot(
        x,
        Math.max(bounds.top - event.clientY, event.clientY - bounds.bottom, 0)
      );
      const captureState =
        captureDistance <= (capture.get() === "captured" ? 76 : 52)
          ? "captured"
          : "free";
      capture.set(captureState);
      cursorIndex.set(
        captureState === "captured"
          ? Math.max(0, Math.min(pointerItems.length - 1, position))
          : position
      );
      approach.set(1 / (1 + (x / 640) ** 2));

      const { target } = event;
      const popup =
        target instanceof view.Element
          ? target.closest("[data-thread-rail-preview]")
          : null;
      const overPreview =
        popup instanceof view.HTMLElement &&
        popup.dataset.threadRailPreview === railId;
      const near =
        x <= 40 &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom;
      if (!near && !overPreview) {
        dismissed.current = false;
      }
      const item =
        pointerItems[
          Math.max(0, Math.min(pointerItems.length - 1, Math.round(position)))
        ];
      setPreview((current) => {
        if (overPreview) {
          return current;
        }
        if (
          !near ||
          !(target instanceof view.Node) ||
          !rail.contains(target) ||
          dismissed.current ||
          item === undefined
        ) {
          return current.kind === "pointer"
            ? { ...current, kind: "idle" }
            : current;
        }
        return current.kind === "pointer" && current.id === item.id
          ? current
          : { id: item.id, kind: "pointer" };
      });
    };

    document.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    document.addEventListener("pointerleave", reset);
    document.addEventListener("pointercancel", reset);
    view.addEventListener("blur", reset);
    finePointer.addEventListener("change", reset);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerleave", reset);
      document.removeEventListener("pointercancel", reset);
      view.removeEventListener("blur", reset);
      finePointer.removeEventListener("change", reset);
    };
  }, [approach, capture, cursorIndex, itemCount, pitch, railId]);

  if (items.length === 0) {
    return null;
  }

  return (
    <LazyMotion features={domAnimation}>
      <Tooltip
        onOpenChange={(open, details) => {
          if (open || details.reason === "trigger-hover") {
            return;
          }
          if (details.reason === "escape-key") {
            dismissed.current = true;
          }
          setPreview((current) => ({ ...current, kind: "idle" }));
        }}
        open={preview.kind !== "idle" && previewItem !== undefined}
        trackCursorAxis={preview.kind === "pointer" ? "y" : "none"}
        triggerId={
          previewItem === undefined ? null : `${railId}-${previewIndex}`
        }
      >
        <nav
          aria-label={label}
          className={cn(
            "relative flex w-10 shrink-0 scrollbar-none flex-col overflow-x-hidden overflow-y-auto overscroll-contain pointer-coarse:w-11",
            className
          )}
          data-thread-rail
          ref={railRef}
          // oxlint-disable-next-line shadcn/no-inline-styles -- The reading viewport supplies its measured available height.
          style={{ maxHeight }}
        >
          {/* The compact navigation marks need stable targets independent of their animated length. */}
          {items.map((item, index) => (
            <TooltipTrigger
              id={`${railId}-${index}`}
              key={item.id}
              aria-current={activeId === item.id ? "location" : undefined}
              aria-label={item.label}
              className="flex h-2.5 min-h-0 w-8 cursor-pointer items-center bg-transparent text-left focus-visible:rounded-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring pointer-coarse:h-6 pointer-coarse:min-h-6 pointer-coarse:w-11 pointer-coarse:shrink-0"
              data-thread-rail-item={item.id}
              onBlur={(event) => {
                if (railRef.current?.contains(event.relatedTarget) !== true) {
                  setPreview((current) => ({ ...current, kind: "idle" }));
                }
              }}
              onClick={() => {
                onSelect(item.id);
              }}
              onFocus={() => {
                dismissed.current = false;
                setPreview({ id: item.id, kind: "focus" });
              }}
              onKeyDown={(event) => {
                let next = index;
                switch (event.key) {
                  case "ArrowUp": {
                    next = Math.max(0, index - 1);
                    break;
                  }
                  case "ArrowDown": {
                    next = Math.min(items.length - 1, index + 1);
                    break;
                  }
                  case "Home": {
                    next = 0;
                    break;
                  }
                  case "End": {
                    next = items.length - 1;
                    break;
                  }
                  case "Escape": {
                    dismissed.current = true;
                    setPreview((current) => ({ ...current, kind: "idle" }));
                    event.stopPropagation();
                    return;
                  }
                  default: {
                    return;
                  }
                }
                event.preventDefault();
                const target = items[next];
                if (target !== undefined) {
                  buttons.current.get(target.id)?.focus();
                }
              }}
              ref={(element: HTMLElement | null) => {
                if (element === null) {
                  buttons.current.delete(item.id);
                } else {
                  buttons.current.set(item.id, element);
                }
              }}
              tabIndex={tabStopId === item.id ? 0 : -1}
              type="button"
            >
              <RailMark
                active={activeId === item.id}
                index={index}
                motion={{ approach, capture, cursorIndex, pitch }}
                reducedMotion={reducedMotion}
              />
            </TooltipTrigger>
          ))}
        </nav>
        <TooltipContent
          className="w-64"
          data-thread-rail-preview={railId}
          onPointerLeave={() => {
            setPreview((current) =>
              current.kind === "pointer"
                ? { ...current, kind: "idle" }
                : current
            );
          }}
          side="right"
          sideOffset={8}
        >
          {previewItem === undefined ? null : (
            <div className="space-y-1">
              {previewItem.meta === undefined ? null : (
                <Text size="micro" tone="muted" truncate>
                  {previewItem.meta}
                </Text>
              )}
              <Text size="sm" truncate weight="medium">
                {previewItem.label}
              </Text>
              {previewItem.description === undefined ? null : (
                <Text
                  className="line-clamp-2 break-words"
                  size="caption"
                  tone="muted"
                >
                  {previewItem.description}
                </Text>
              )}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </LazyMotion>
  );
};
