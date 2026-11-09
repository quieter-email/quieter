"use client";

import { useRef } from "react";
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
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export const CardStack = ({
  items,
  totalCount,
  footer,
  label,
  onOpenChange,
  open,
}: CardStackProps) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [first, ...rest] = items.slice(0, 3);

  if (first === undefined) {
    return null;
  }

  return (
    <Collapsible
      aria-label={label}
      className="card-stack"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open && !event.defaultPrevented) {
          event.preventDefault();
          onOpenChange(false);
          triggerRef.current?.focus({ preventScroll: true });
        }
      }}
      onOpenChange={onOpenChange}
      open={open}
    >
      <div className="card-stack-summary">
        {!open && totalCount > 2 ? (
          <div aria-hidden className="card-stack-peek card-stack-peek-back" />
        ) : null}
        {!open && totalCount > 1 ? (
          <div aria-hidden className="card-stack-peek card-stack-peek-front" />
        ) : null}
        <div className="card-stack-row card-stack-row-summary" key={first.id}>
          {first.content}
          {totalCount > 1 ? (
            <CollapsibleTrigger
              aria-label={`${open ? "Hide" : "Show"} ${totalCount - 1} more ${label.toLowerCase()}`}
              render={<Button ref={triggerRef} size="xs" variant="option" />}
            >
              +{totalCount - 1}
              <ChevronDownIcon className={open ? "rotate-180" : undefined} />
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
