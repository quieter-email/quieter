"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "./button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "./collapsible";
import { ChevronDownIcon } from "./icons";

export type CardStackItem = {
  id: string;
  content: ReactNode;
};

export type CardStackProps = {
  items: CardStackItem[];
  totalCount: number;
  footer?: ReactNode;
  label: string;
  onPinnedChange: (pinned: boolean) => void;
  pinned: boolean;
};

export const CardStack = ({
  items,
  totalCount,
  footer,
  label,
  onPinnedChange,
  pinned,
}: CardStackProps) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hoverTimerRef = useRef(0);
  const [hover, setHover] = useState<"inactive" | "preview" | "dismissed">(
    "inactive"
  );
  const expanded = pinned || hover === "preview";
  const [first, ...rest] = items.slice(0, 3);

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimerRef.current);
    },
    []
  );

  if (first === undefined) {
    return null;
  }

  return (
    <Collapsible
      aria-label={label}
      className="card-stack"
      onFocusCapture={(event) => {
        if (
          hover === "preview" &&
          triggerRef.current?.contains(event.target) !== true
        ) {
          onPinnedChange(true);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded && !event.defaultPrevented) {
          event.preventDefault();
          window.clearTimeout(hoverTimerRef.current);
          setHover("dismissed");
          onPinnedChange(false);
          triggerRef.current?.focus({ preventScroll: true });
        }
      }}
      onOpenChange={() => {
        window.clearTimeout(hoverTimerRef.current);
        setHover(pinned ? "dismissed" : "inactive");
        onPinnedChange(!pinned);
      }}
      onPointerDownCapture={(event) => {
        if (
          hover === "preview" &&
          event.target instanceof Node &&
          triggerRef.current?.contains(event.target) !== true
        ) {
          onPinnedChange(true);
        }
      }}
      onPointerEnter={(event) => {
        if (
          event.pointerType !== "mouse" ||
          !window.matchMedia("(hover: hover) and (pointer: fine)").matches ||
          totalCount < 2 ||
          hover === "dismissed"
        ) {
          return;
        }
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = window.setTimeout(() => {
          setHover("preview");
        }, 120);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") {
          window.clearTimeout(hoverTimerRef.current);
          setHover("inactive");
        }
      }}
      open={expanded}
    >
      <div className="card-stack-summary">
        {!expanded && totalCount > 2 ? (
          <div aria-hidden className="card-stack-peek card-stack-peek-back" />
        ) : null}
        {!expanded && totalCount > 1 ? (
          <div aria-hidden className="card-stack-peek card-stack-peek-front" />
        ) : null}
        <div className="card-stack-row card-stack-row-summary" key={first.id}>
          {first.content}
          {totalCount > 1 ? (
            <CollapsibleTrigger
              aria-label={
                hover === "preview" && !pinned
                  ? `Keep ${label.toLowerCase()} expanded`
                  : `${pinned ? "Hide" : "Show"} ${totalCount - 1} more ${label.toLowerCase()}`
              }
              render={<Button ref={triggerRef} size="xs" variant="option" />}
            >
              +{totalCount - 1}
              <ChevronDownIcon
                className={expanded ? "rotate-180" : undefined}
              />
            </CollapsibleTrigger>
          ) : null}
        </div>
      </div>
      <CollapsiblePanel>
        <div className="min-h-0">
          <div className="card-stack-continuation">
            {rest.map((item) => (
              <div className="card-stack-row" key={item.id}>
                {item.content}
              </div>
            ))}
            {totalCount > 3 && footer !== undefined ? (
              <div className="card-stack-footer">{footer}</div>
            ) : null}
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
};
