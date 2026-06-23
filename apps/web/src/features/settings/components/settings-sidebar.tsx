"use client";

import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Mail01Icon,
  Settings01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn, IconButtonTooltip } from "@quieter/ui";
import { AnimatePresence, domMax, LayoutGroup, LazyMotion, m } from "motion/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { SettingsTab } from "~/features/settings/domain/settings-tab";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { SidebarNavItem } from "~/features/navigation/components/sidebar-nav-item";

type SettingsSidebarProps = {
  activeTab: SettingsTab;
  onBack: () => void;
  onSelectTab: (tab: SettingsTab) => void;
  isMobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
};

const SETTINGS_SIDEBAR_NAV = [
  { tab: "general", label: "General", icon: Settings01Icon },
  { tab: "account", label: "Account", icon: UserIcon },
  { tab: "mailboxes", label: "Mailboxes", icon: Mail01Icon },
  { tab: "organization", label: "Teams", icon: UserGroupIcon },
] as const satisfies ReadonlyArray<{
  tab: SettingsTab;
  label: string;
  icon: typeof Settings01Icon;
}>;

type SidebarContentProps = {
  activeTab: SettingsTab;
  onBack: () => void;
  onSelectTab: (tab: SettingsTab) => void;
  onRequestClose?: () => void;
};

const SidebarContent = ({
  activeTab,
  onBack,
  onSelectTab,
  onRequestClose,
}: SidebarContentProps) => {
  const [hoveredTab, setHoveredTab] = useState<SettingsTab | null>(null);
  const [exitingTab, setExitingTab] = useState<SettingsTab | null>(null);
  const [hoverEnter, setHoverEnter] = useState(false);
  const [hoverSession, setHoverSession] = useState(0);
  const navRef = useRef<HTMLDivElement>(null);

  const setHover = (tab: SettingsTab) => {
    setHoverEnter(hoveredTab === null);
    if (hoveredTab === null) {
      setHoverSession((current) => current + 1);
    }
    setExitingTab(null);
    setHoveredTab(tab);
  };

  const clearHover = () => {
    if (hoveredTab !== null) {
      setExitingTab(hoveredTab);
    }
    setHoverEnter(false);
    setHoveredTab(null);
  };

  const clearHoverIfLeavingNav = (nextTarget: EventTarget | null) => {
    if (!nextTarget || !navRef.current?.contains(nextTarget as Node)) {
      clearHover();
    }
  };

  const handleSelectTab = (tab: SettingsTab) => {
    onSelectTab(tab);
    onRequestClose?.();
  };

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col p-6">
      <div className="flex min-w-0 items-center justify-between gap-2 rounded-md">
        <Button
          className="w-fit text-muted-foreground hover:text-foreground"
          onClick={onBack}
          size="sm"
          variant="ghost"
        >
          <HugeiconsIcon className="size-4" icon={ArrowLeft01Icon} />
          <span>Back</span>
        </Button>

        {onRequestClose && (
          <IconButtonTooltip label="Close sidebar">
            <Button
              aria-label="Close sidebar"
              className="-mr-2 md:hidden"
              onClick={onRequestClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
            </Button>
          </IconButtonTooltip>
        )}
      </div>

      <LayoutGroup id="settings-sidebar">
        <div ref={navRef} className="flex flex-col gap-1 pt-6" onMouseLeave={clearHover}>
          {SETTINGS_SIDEBAR_NAV.map(({ tab, label, icon }) => {
            const isActive = activeTab === tab;
            const isHovered = hoveredTab === tab;
            const isHoverExiting = exitingTab === tab;

            return (
              <SidebarNavItem
                active={isActive}
                aria-current={isActive ? "page" : undefined}
                className={cn("flex w-full items-center justify-start gap-3 px-3 text-left", {
                  "text-foreground": isActive || isHovered,
                  "text-muted-foreground": !isActive && !isHovered,
                })}
                hover={isHovered}
                hoverEnter={hoverEnter && isHovered}
                hoverExiting={isHoverExiting}
                hoverLayoutId={`settings-sidebar-hover-${hoverSession}`}
                key={tab}
                onBlur={(event) => clearHoverIfLeavingNav(event.relatedTarget)}
                onClick={() => handleSelectTab(tab)}
                onFocus={() => {
                  if (!isActive) setHover(tab);
                }}
                onHoverExitComplete={() => {
                  setExitingTab(null);
                }}
                onMouseEnter={() => {
                  if (isActive) {
                    clearHover();
                    return;
                  }
                  setHover(tab);
                }}
                size="sm"
              >
                <HugeiconsIcon className="size-4 shrink-0" icon={icon} />
                <span>{label}</span>
              </SidebarNavItem>
            );
          })}
        </div>
      </LayoutGroup>
    </div>
  );
};

export const SettingsSidebar = ({
  activeTab,
  onBack,
  onSelectTab,
  isMobileOpen,
  onMobileOpenChange,
}: SettingsSidebarProps) => {
  const closeMobileSidebar = useEffectEvent(() => {
    onMobileOpenChange?.(false);
  });

  useEffect(() => {
    if (!isMobileOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileOpen]);

  return (
    <LazyMotion features={domMax}>
      <>
        <aside
          className="relative hidden h-full shrink-0 bg-transparent text-foreground md:flex md:flex-col"
          style={{ width: "272px" }}
        >
          <SidebarContent activeTab={activeTab} onBack={onBack} onSelectTab={onSelectTab} />
        </aside>

        <AnimatePresence initial={false}>
          {isMobileOpen && (
            <>
              <m.button
                aria-label="Close sidebar"
                className="fixed inset-0 z-40 bg-background-dark/50 backdrop-blur-[2px] md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => onMobileOpenChange?.(false)}
                type="button"
              />
              <m.aside
                aria-label="Settings sidebar"
                aria-modal="true"
                className="fixed inset-y-0 left-0 isolate z-50 flex w-[min(20rem,calc(100vw-2.5rem))] flex-col overflow-hidden bg-background-dark pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground shadow-2xl md:hidden"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                role="dialog"
                transition={{ type: "spring", bounce: 0, duration: 0.24 }}
              >
                <WorkspaceDitherBackground />
                <SidebarContent
                  activeTab={activeTab}
                  onBack={onBack}
                  onSelectTab={onSelectTab}
                  onRequestClose={() => onMobileOpenChange?.(false)}
                />
              </m.aside>
            </>
          )}
        </AnimatePresence>
      </>
    </LazyMotion>
  );
};
