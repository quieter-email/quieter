"use client";

import { Settings02Icon } from "@hugeicons/core-free-icons";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@quieter/ui/context-menu";
import { Icon } from "@quieter/ui/icon";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export const SidebarContextActions = createContext<(() => void) | null>(null);

type SidebarAction =
  | {
      label: string;
      onSelect: () => void;
      tone?: "destructive";
    }
  | {
      checked: boolean;
      label: string;
      onCheckedChange: (checked: boolean) => void;
    };

const emptyActions: readonly SidebarAction[] = [];

export const SidebarContextMenu = ({
  actions = emptyActions,
  children,
  className,
}: {
  actions?: readonly SidebarAction[];
  children: ReactNode;
  className?: string;
}) => {
  const customize = useContext(SidebarContextActions);
  if (customize === null) {
    return <div className={className}>{children}</div>;
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={className}
        onContextMenu={(event) => {
          if (
            !(event.target instanceof Node) ||
            !event.currentTarget.contains(event.target)
          ) {
            event.preventBaseUIHandler();
          }
        }}
        onTouchStart={(event) => {
          if (
            !(event.target instanceof Node) ||
            !event.currentTarget.contains(event.target)
          ) {
            event.preventBaseUIHandler();
          }
        }}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            !(event.target instanceof HTMLElement) ||
            !event.currentTarget.contains(event.target) ||
            !(
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10") ||
              (event.altKey && event.key === "ArrowDown")
            )
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const bounds = event.target.getBoundingClientRect();
          event.target.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: bounds.left,
              clientY: bounds.bottom,
            })
          );
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent align="start">
        {actions.map((action) =>
          "checked" in action ? (
            <ContextMenuCheckboxItem
              checked={action.checked}
              closeOnSelect
              key={action.label}
              onCheckedChange={(checked) => {
                action.onCheckedChange(checked);
              }}
            >
              {action.label}
            </ContextMenuCheckboxItem>
          ) : (
            <ContextMenuItem
              key={action.label}
              onSelect={() => {
                action.onSelect();
              }}
              tone={action.tone}
            >
              {action.label}
            </ContextMenuItem>
          )
        )}
        {actions.length > 0 && <ContextMenuSeparator />}
        <ContextMenuItem
          onSelect={() => {
            customize();
          }}
        >
          <Icon aria-hidden icon={Settings02Icon} />
          Customize sidebar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
