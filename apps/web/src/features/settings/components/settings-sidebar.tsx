"use client";

import {
  ArrowLeft01Icon,
  CreditCardIcon,
  Mail01Icon,
  Settings01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, cn } from "@quieter/ui";
import { LayoutGroup } from "motion/react";
import { useState } from "react";
import type { SettingsTab } from "~/features/settings/domain/settings-tab";
import { AnimatedHoverSurface } from "~/components/animated-hover-surface";

type SettingsSidebarProps = {
  activeTab: SettingsTab;
  onBack: () => void;
  onSelectTab: (tab: SettingsTab) => void;
};

const SETTINGS_SIDEBAR_NAV = [
  { tab: "general", label: "General", icon: Settings01Icon },
  { tab: "account", label: "Account", icon: UserIcon },
  { tab: "plan", label: "Plan", icon: CreditCardIcon },
  { tab: "mailboxes", label: "Mailboxes", icon: Mail01Icon },
  { tab: "organization", label: "Organizations", icon: UserGroupIcon },
] as const satisfies ReadonlyArray<{
  tab: SettingsTab;
  label: string;
  icon: typeof Settings01Icon;
}>;

export const SettingsSidebar = ({ activeTab, onBack, onSelectTab }: SettingsSidebarProps) => {
  const [hoveredTab, setHoveredTab] = useState<SettingsTab | null>(null);
  const highlightedTab = hoveredTab ?? activeTab;

  return (
    <aside className="border-b pb-4 md:mr-20 md:border-r md:border-b-0 md:pr-20 md:pb-0">
      <Button
        className="w-fit text-muted-foreground hover:text-foreground"
        onClick={onBack}
        size="sm"
        variant="ghost"
      >
        <HugeiconsIcon className="size-4" icon={ArrowLeft01Icon} />
        <span>Back</span>
      </Button>

      <LayoutGroup id="settings-sidebar-hover">
        <div className="flex flex-wrap gap-2 pt-6 md:flex-col md:pt-12">
          {SETTINGS_SIDEBAR_NAV.map(({ tab, label, icon }) => {
            const isActive = activeTab === tab;
            return (
              <div
                className="relative rounded-md"
                key={tab}
                onBlur={() => setHoveredTab(null)}
                onFocus={() => setHoveredTab(tab)}
                onMouseEnter={() => setHoveredTab(tab)}
                onMouseLeave={() => setHoveredTab(null)}
              >
                <AnimatedHoverSurface
                  className={cn({
                    "bg-primary": isActive && highlightedTab === tab,
                    "bg-muted/60": !isActive || highlightedTab !== tab,
                  })}
                  layoutId="settings-sidebar-hover"
                  visible={highlightedTab === tab}
                />
                <Button
                  aria-current={isActive ? "page" : undefined}
                  className={cn("flex w-full items-center justify-start gap-2", {
                    "bg-primary text-primary-foreground shadow-sm": isActive,
                    "bg-transparent": !isActive,
                  })}
                  hoverLayer={false}
                  onClick={() => onSelectTab(tab)}
                  size="sm"
                  variant="ghost"
                >
                  <HugeiconsIcon className="size-4" icon={icon} />
                  {label}
                </Button>
              </div>
            );
          })}
        </div>
      </LayoutGroup>
    </aside>
  );
};
