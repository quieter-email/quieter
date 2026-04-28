"use client";

import {
  ArrowLeft01Icon,
  Mail01Icon,
  Settings01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui";
import type { SettingsTab } from "~/features/settings/domain/settings-tab";

type SettingsSidebarProps = {
  activeTab: SettingsTab;
  onBack: () => void;
  onSelectTab: (tab: SettingsTab) => void;
};

export const SettingsSidebar = ({ activeTab, onBack, onSelectTab }: SettingsSidebarProps) => (
  <aside className="mr-20 border-r pr-20">
    <button
      className="inline-flex h-8 w-fit shrink-0 items-center justify-center gap-2 rounded-md border border-transparent bg-transparent px-3 text-xs leading-none font-medium whitespace-nowrap text-muted-foreground outline-none select-none hover:border-border/80 hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-muted/80 disabled:pointer-events-none disabled:opacity-50"
      onClick={onBack}
      type="button"
    >
      <HugeiconsIcon className="size-4" icon={ArrowLeft01Icon} />
      <span>Back</span>
    </button>

    <div className="flex flex-col gap-2 pt-12">
      <Button
        className="flex w-fit items-center gap-2"
        onClick={() => onSelectTab("general")}
        size="sm"
        variant={activeTab === "general" ? "default" : "ghost"}
      >
        <HugeiconsIcon className="size-4" icon={Settings01Icon} />
        General
      </Button>

      <Button
        className="flex w-fit items-center gap-2"
        onClick={() => onSelectTab("account")}
        size="sm"
        variant={activeTab === "account" ? "default" : "ghost"}
      >
        <HugeiconsIcon className="size-4" icon={UserIcon} />
        Account
      </Button>

      <Button
        className="flex w-fit items-center gap-2"
        onClick={() => onSelectTab("mailboxes")}
        size="sm"
        variant={activeTab === "mailboxes" ? "default" : "ghost"}
      >
        <HugeiconsIcon className="size-4" icon={Mail01Icon} />
        Mailboxes
      </Button>

      <Button
        className="flex w-fit items-center gap-2"
        onClick={() => onSelectTab("organization")}
        size="sm"
        variant={activeTab === "organization" ? "default" : "ghost"}
      >
        <HugeiconsIcon className="size-4" icon={UserGroupIcon} />
        Teams
      </Button>
    </div>
  </aside>
);
