"use client";

import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, IconButtonTooltip } from "@quieter/ui";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { type SettingsTab } from "~/features/settings/domain/settings-tab";
import { settingsRouteApi } from "~/lib/route-apis";
import { AccountSettingsPanel } from "./account-settings-panel";
import { BillingCheckoutResult } from "./billing-checkout-result";
import { GeneralSettingsPanel } from "./general-settings-panel";
import { MailboxesSettingsPanel } from "./mailboxes-settings-panel";
import { OrganizationSettingsPanel } from "./organization-settings-panel";
import { SettingsSidebar } from "./settings-sidebar";

type SettingsUser = {
  email: string;
  emailVerified: boolean;
  image?: string | null;
  name: string;
};

type SettingsScreenProps = {
  initialUser: SettingsUser;
};

export const SettingsScreen = ({ initialUser }: SettingsScreenProps) => {
  const navigate = useNavigate({
    from: "/settings",
  });
  const { from, tab } = settingsRouteApi.useSearch();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const setTab = (nextTab: SettingsTab) => {
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        tab: nextTab,
        organizationId: "",
        organizationView: "overview",
      }),
      to: ".",
    });
  };

  return (
    <main className="relative isolate flex h-dvh min-h-0 flex-col overflow-hidden bg-background-dark text-foreground">
      <BillingCheckoutResult />
      <WorkspaceDitherBackground />
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        <SettingsSidebar
          activeTab={tab}
          isMobileOpen={isMobileSidebarOpen}
          onBack={() => {
            void navigate({
              to: from,
            });
          }}
          onMobileOpenChange={setIsMobileSidebarOpen}
          onSelectTab={setTab}
        />

        <div className="relative min-h-0 flex-1 overflow-hidden bg-transparent">
          <div className="absolute inset-1.5 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background/60">
            {/* Mobile Top Bar */}
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/40 px-4 md:hidden">
              <IconButtonTooltip label="Open settings sidebar">
                <Button
                  aria-label="Open settings sidebar"
                  onClick={() => setIsMobileSidebarOpen(true)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={SidebarLeftIcon} />
                </Button>
              </IconButtonTooltip>
              <span className="text-sm font-semibold text-foreground capitalize">
                {`${tab} Settings`}
              </span>
            </div>

            {/* Scrollable content container */}
            <div className="min-h-0 flex-1 overflow-y-auto px-12 py-8 md:px-16 md:py-12">
              {tab === "general" && <GeneralSettingsPanel />}
              {tab === "account" && <AccountSettingsPanel initialUser={initialUser} />}
              {tab === "mailboxes" && <MailboxesSettingsPanel />}
              {tab === "organization" && <OrganizationSettingsPanel />}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};
