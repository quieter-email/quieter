"use client";

import { Chat01Icon, InboxIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
import { LayoutGroup } from "motion/react";
import type { MailboxWorkspaceView } from "~/features/mailbox/domain/mailbox-workspace-view";
import { SidebarNavItem } from "~/features/navigation/components/sidebar-nav-item";
import { SidebarEntrance } from "~/features/navigation/components/sidebar-surfaces";
import { useSidebarNavHover } from "~/features/navigation/hooks/use-sidebar-nav-hover";

const WORKSPACE_VIEW_OPTIONS: ReadonlyArray<{
  id: MailboxWorkspaceView;
  label: string;
  icon: IconSvgElement;
}> = [
  { id: "inbox", label: "Mail", icon: InboxIcon },
  { id: "chat", label: "Chat", icon: Chat01Icon },
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
}: SidebarWorkspaceViewSwitchProps) => {
  const {
    clearHover,
    clearHoverIfLeavingNav,
    hoverEnter,
    hoverLayoutId,
    isHoverExiting,
    isHovered,
    navRef,
    onHoverExitComplete,
    setHover,
  } = useSidebarNavHover<MailboxWorkspaceView>("workspace-view-hover");

  return (
    <SidebarEntrance animateEntrance={animateEntrance} className="w-full min-w-0" index={1}>
      <LayoutGroup id="workspace-view">
        <nav
          ref={navRef}
          aria-label="Workspace"
          className="flex w-full min-w-0 gap-0.5"
          onMouseLeave={clearHover}
        >
          {WORKSPACE_VIEW_OPTIONS.map(({ id, label, icon }) => {
            const isActive = selectedView === id;
            const itemHovered = isHovered(id);

            return (
              <div key={id} className="min-w-0 flex-1 overflow-hidden">
                <SidebarNavItem
                  active={isActive}
                  aria-current={isActive ? "page" : undefined}
                  className={cn("justify-center gap-2 px-3", {
                    "text-foreground": isActive || itemHovered,
                    "text-muted-foreground": !isActive && !itemHovered,
                  })}
                  hover={itemHovered}
                  hoverEnter={itemHovered && hoverEnter}
                  hoverExiting={isHoverExiting(id)}
                  hoverLayoutId={hoverLayoutId}
                  onBlur={(event) => clearHoverIfLeavingNav(event.relatedTarget)}
                  onClick={() => onSelectView(id)}
                  onFocus={() => {
                    if (!isActive) setHover(id);
                  }}
                  onHoverExitComplete={onHoverExitComplete}
                  onMouseEnter={() => {
                    if (isActive) {
                      clearHover();
                      return;
                    }
                    setHover(id);
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
      </LayoutGroup>
    </SidebarEntrance>
  );
};
