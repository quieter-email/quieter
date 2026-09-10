"use client";

import { Chat01Icon, InboxIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";

import { loadChatView } from "#/features/mailbox/components/mailbox-workspace/workspace-component-loaders";
import type { MailboxWorkspaceView } from "#/features/mailbox/domain/mailbox-workspace-view";
import { SidebarNavItem } from "#/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "#/features/navigation/components/sidebar-surfaces";

const WORKSPACE_VIEW_OPTIONS: readonly {
  id: MailboxWorkspaceView;
  label: string;
  icon: IconSvgElement;
}[] = [
  { icon: InboxIcon, id: "inbox", label: "Mail" },
  { icon: Chat01Icon, id: "chat", label: "Chat" },
];

type SidebarWorkspaceViewSwitchProps = {
  animateEntrance: boolean;
  onSelectView: (view: MailboxWorkspaceView) => void;
  selectedView: MailboxWorkspaceView;
};

export const SidebarWorkspaceViewSwitch = ({
  animateEntrance,
  onSelectView,
  selectedView,
}: SidebarWorkspaceViewSwitchProps) => (
  <SidebarEntrance
    animateEntrance={animateEntrance}
    className="w-full min-w-0"
    index={1}
  >
    <nav aria-label="Workspace" className="flex w-full min-w-0 gap-0.5">
      {WORKSPACE_VIEW_OPTIONS.map(({ id, label, icon }) => {
        const isActive = selectedView === id;

        return (
          <div key={id} className="min-w-0 flex-1">
            <SidebarNavItem
              active={isActive}
              aria-current={isActive ? "page" : undefined}
              className={cn("justify-center gap-2 px-3", {
                "text-fg": isActive,
                "text-muted-fg": !isActive,
              })}
              onClick={() => {
                onSelectView(id);
              }}
              onFocus={() => {
                if (id === "chat") {
                  void loadChatView();
                }
              }}
              onMouseEnter={() => {
                if (id === "chat") {
                  void loadChatView();
                }
              }}
              onPointerDown={() => {
                if (id === "chat") {
                  void loadChatView();
                }
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon
                aria-hidden
                className="size-3.5 shrink-0"
                icon={icon}
                strokeWidth={1.5}
              />
              {label}
            </SidebarNavItem>
          </div>
        );
      })}
    </nav>
  </SidebarEntrance>
);
