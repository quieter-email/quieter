"use client";

import { cn } from "@quieter/ui";
import { Children, isValidElement, type PropsWithChildren, type ReactNode } from "react";
import { useLayoutEffect, useMemo, useState } from "react";

type SlotItem = {
  children: ReactNode;
  key: string;
  phase: "active" | "enter" | "exit";
};

const primitive = (value: unknown) =>
  value == null || ["bigint", "boolean", "number", "string"].includes(typeof value);

const signature = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child, index) => {
      if (!isValidElement<{ children?: ReactNode }>(child)) {
        return `${typeof child}:${String(child)}`;
      }

      const props = Object.entries(child.props)
        .filter(([name, value]) => name !== "children" && name !== "className" && primitive(value))
        .map(([name, value]) => `${name}:${String(value)}`)
        .join(",");

      return `${index}:${typeof child.type === "string" ? child.type : ""}:${props}:${signature(child.props.children)}`;
    })
    .join("|");

export const VerticalSlot = ({
  children,
  className,
  duration = 500,
}: PropsWithChildren<{ className?: string; duration?: number }>) => {
  const key = useMemo(() => signature(children), [children]);
  const [items, setItems] = useState<Array<SlotItem>>([{ children, key, phase: "active" }]);

  useLayoutEffect(() => {
    setItems((current) => {
      const active = current.at(-1);

      return active?.key === key
        ? current.map((item, index) =>
            index === current.length - 1 ? { children, key, phase: "active" } : item,
          )
        : [
            ...(active ? [{ ...active, phase: "exit" as const }] : []),
            { children, key, phase: "enter" },
          ];
    });
  }, [children, key]);

  useLayoutEffect(() => {
    if (items.at(-1)?.phase !== "enter") {
      return;
    }

    const frame = requestAnimationFrame(() => {
      setItems((current) =>
        current.map((item, index) =>
          index === current.length - 1 ? { ...item, phase: "active" } : item,
        ),
      );
    });

    return () => cancelAnimationFrame(frame);
  }, [items]);

  return (
    <div className={cn("relative grid overflow-hidden", className)}>
      <div aria-hidden className="invisible col-start-1 row-start-1">
        {children}
      </div>
      {items.map((item) => (
        <div
          className={cn(
            "absolute inset-0 transition-[translate,opacity] ease-out will-change-transform",
            item.phase === "enter" && "-translate-y-full opacity-0",
            item.phase === "active" && "translate-y-0 opacity-100",
            item.phase === "exit" && "translate-y-full opacity-0",
          )}
          key={item.key}
          onTransitionEnd={() => {
            if (item.phase === "exit") {
              setItems((current) => current.filter((currentItem) => currentItem.key !== item.key));
            }
          }}
          style={{ transitionDuration: `${duration}ms` }}
        >
          {item.children}
        </div>
      ))}
    </div>
  );
};
