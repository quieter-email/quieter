"use client";

import { cn } from "@quieter/ui/cn";
import {
  Children,
  isValidElement,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { PropsWithChildren, ReactNode, TransitionEvent } from "react";

type SlotItem = {
  children: ReactNode;
  key: string;
  phase: "active" | "enter" | "exit";
};

const primitive = (value: unknown) =>
  value === null ||
  value === undefined ||
  ["bigint", "boolean", "number", "string"].includes(typeof value);

const primitiveSignature = (value: unknown) => {
  switch (typeof value) {
    case "bigint":
    case "boolean":
    case "number":
    case "string": {
      return `${value}`;
    }
    case "function":
    case "object":
    case "symbol": {
      return value === null ? "null" : typeof value;
    }
    case "undefined": {
      return "undefined";
    }
    default: {
      return "unknown";
    }
  }
};

const signature = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child, index) => {
      if (!isValidElement<{ children?: ReactNode }>(child)) {
        return `${typeof child}:${primitiveSignature(child)}`;
      }

      const props = Object.entries(child.props)
        .flatMap(([name, value]) =>
          name !== "children" && name !== "className" && primitive(value)
            ? [`${name}:${primitiveSignature(value)}`]
            : []
        )
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
  const [state, setState] = useState<{ items: SlotItem[]; key: string }>(
    () => ({
      items: [{ children, key, phase: "active" }],
      key,
    })
  );
  let { items } = state;

  if (state.key !== key) {
    const active = state.items.at(-1);
    items = [
      ...(active ? [{ ...active, phase: "exit" as const }] : []),
      { children, key, phase: "enter" },
    ];
    setState({ items, key });
  } else if (items.at(-1)?.children !== children) {
    items = items.map((item, index) =>
      index === items.length - 1 ? { children, key, phase: "active" } : item
    );
    setState({ items, key });
  }

  useLayoutEffect((): (() => void) | undefined => {
    if (items.at(-1)?.phase !== "enter") {
      return undefined;
    }

    const frame = requestAnimationFrame(() => {
      setState((current) => ({
        ...current,
        items: current.items.map((item, index) =>
          index === current.items.length - 1
            ? { ...item, phase: "active" }
            : item
        ),
      }));
    });

    return () => {
      cancelAnimationFrame(frame);
    };
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
            {
              "-translate-y-full opacity-0": item.phase === "enter",
              "translate-y-0 opacity-100": item.phase === "active",
              "translate-y-full opacity-0": item.phase === "exit",
            }
          )}
          key={item.key}
          onTransitionEnd={(event: TransitionEvent<HTMLDivElement>) => {
            if (event.currentTarget === event.target && item.phase === "exit") {
              setState((current) => ({
                ...current,
                items: current.items.filter(
                  (currentItem) => currentItem.key !== item.key
                ),
              }));
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
