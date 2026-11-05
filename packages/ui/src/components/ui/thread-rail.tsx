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
import { useId, useRef, useState } from "react";

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
  className?: string;
};

type Preview =
  | { kind: "idle"; id: string | null }
  | { kind: "pointer" | "focus"; id: string };

type RailMotion = {
  cursorIndex: MotionValue<number>;
  approach: MotionValue<number>;
  wave: MotionValue<number>;
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
    const distance = index - motion.cursorIndex.get();
    const broad = Math.exp(-(distance ** 2) / 18);
    const near = Math.exp(-(distance ** 2) / 5);
    return (
      1 + broad * motion.approach.get() * 0.5 + near * motion.wave.get() * 3
    );
  });
  const scale = useSpring(target, { bounce: 0.2, duration: 0.28 });
  const transform = useTransform(scale, (value) => `scaleX(${value})`);
  const opacity = useTransform(scale, (value) =>
    Math.max(active ? 0.65 : 0.22, Math.min(1, 0.22 + (value - 1) * 0.24))
  );

  return (
    <m.span
      aria-hidden
      className="pointer-events-none block h-0.5 w-1.5 origin-left bg-fg motion-reduce:transform-none!"
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
  onSelect,
}: ThreadRailProps) => {
  const reducedMotion = useReducedMotion() === true;
  const railId = useId();
  const cursorIndex = useMotionValue(0);
  const approach = useMotionValue(0);
  const wave = useMotionValue(0);
  const [preview, setPreview] = useState<Preview>({ id: null, kind: "idle" });
  const dismissed = useRef(false);
  const buttons = useRef(new Map<string, HTMLElement>());
  const previewIndex = items.findIndex((item) => item.id === preview.id);
  const previewItem = items[previewIndex];
  const tabStopId =
    preview.kind === "focus" && items.some((item) => item.id === preview.id)
      ? preview.id
      : (items.find((item) => item.id === activeId)?.id ?? items[0]?.id);

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
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The navigation senses proximity while native buttons own activation and keyboard behavior. */}
        <nav
          aria-label={label}
          className={cn("relative w-36 shrink-0", className)}
          data-thread-rail
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setPreview((current) => ({ ...current, kind: "idle" }));
            }
          }}
          onPointerCancel={() => {
            approach.set(0);
            wave.set(0);
            setPreview((current) => ({ ...current, kind: "idle" }));
          }}
          onPointerLeave={(event) => {
            approach.set(0);
            wave.set(0);
            dismissed.current = false;
            if (
              event.relatedTarget instanceof Element &&
              event.relatedTarget.closest("[data-thread-rail-preview]") !== null
            ) {
              return;
            }
            setPreview((current) =>
              current.kind === "pointer"
                ? { ...current, kind: "idle" }
                : current
            );
          }}
          onPointerMove={(event) => {
            if (
              event.pointerType === "touch" ||
              !window.matchMedia("(hover: hover) and (pointer: fine)")
                .matches ||
              !(event.target instanceof Node) ||
              !event.currentTarget.contains(event.target)
            ) {
              return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = Math.max(0, event.clientX - bounds.left);
            const position =
              ((event.clientY - bounds.top) / bounds.height) * items.length -
              0.5;
            const pull = Math.max(0, 1 - x / 128);
            const close = Math.max(0, 1 - x / 40);
            cursorIndex.set(position);
            approach.set(pull * pull * (3 - 2 * pull));
            wave.set(close * close * (3 - 2 * close));
            const item =
              items[
                Math.max(0, Math.min(items.length - 1, Math.round(position)))
              ];
            setPreview((current) => {
              if (x > 40 || dismissed.current || item === undefined) {
                return current.kind === "pointer"
                  ? { ...current, kind: "idle" }
                  : current;
              }
              return current.kind === "pointer" && current.id === item.id
                ? current
                : { id: item.id, kind: "pointer" };
            });
          }}
        >
          {/* The compact navigation marks need stable targets independent of their animated length. */}
          {items.map((item, index) => (
            <TooltipTrigger
              id={`${railId}-${index}`}
              key={item.id}
              aria-current={activeId === item.id ? "location" : undefined}
              aria-label={item.label}
              className="flex h-2.5 w-8 cursor-pointer items-center bg-transparent text-left focus-visible:rounded-xs focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring pointer-coarse:h-6 pointer-coarse:w-11"
              data-thread-rail-item={item.id}
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
                motion={{ approach, cursorIndex, wave }}
                reducedMotion={reducedMotion}
              />
            </TooltipTrigger>
          ))}
        </nav>
        <TooltipContent
          className="w-64"
          data-thread-rail-preview
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
