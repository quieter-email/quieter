"use client";

import { Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BillingCheckoutResult } from "@quieter/app/features/settings/components/billing-checkout-result";
import { ConnectorConnectionResult } from "@quieter/app/features/settings/components/connector-connection-result";
import { GmailConnectionResult } from "@quieter/app/features/settings/components/gmail-connection-result";
import { SettingsBreadcrumbs } from "@quieter/app/features/settings/components/settings-breadcrumbs";
import { SettingsDataPrefetch } from "@quieter/app/features/settings/components/settings-data-prefetch";
import {
  SettingsLoadingState,
  SettingsPageHeader,
} from "@quieter/app/features/settings/components/settings-layout";
import { SettingsSearch } from "@quieter/app/features/settings/components/settings-search";
import { SettingsSidebar } from "@quieter/app/features/settings/components/settings-sidebar";
import { isDemoModeAvailable } from "@quieter/app/features/settings/domain/demo-mode-setting";
import { SETTINGS_TITLES } from "@quieter/app/features/settings/domain/settings-navigation";
import { settingsRouteApi } from "@quieter/app/lib/route-apis";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { WorkspaceSidebar } from "@quieter/ui/workspace-sidebar";
import { lazy, Suspense, useState } from "react";

const AccountSettingsPanel = lazy(
  async () =>
    await import("@quieter/app/features/settings/components/account-settings-panel").then(
      ({ AccountSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const AiSettingsPanel = lazy(
  async () =>
    await import("@quieter/app/features/settings/components/ai-settings-panel").then(
      ({ AiSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const ConnectorsSettingsPanel = lazy(
  async () =>
    await import("@quieter/app/features/settings/components/connectors-settings-panel").then(
      ({ ConnectorsSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const MailboxesSettingsPanel = lazy(
  async () =>
    await import("@quieter/app/features/settings/components/mailboxes-settings-panel").then(
      ({ MailboxesSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const OrganizationSettingsPanel = lazy(
  async () =>
    await import("@quieter/app/features/settings/components/organization-settings-panel").then(
      ({ OrganizationSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const preferenceSettingsPanels = async () =>
  await import("@quieter/app/features/settings/components/preference-settings-panels");
const PreferencesSettingsPanel = lazy(
  async () =>
    await preferenceSettingsPanels().then(
      ({ PreferencesSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const DevelopmentSettingsPanel = lazy(
  async () =>
    await preferenceSettingsPanels().then(
      ({ DevelopmentSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const DevelopmentSettingsUnavailable = lazy(
  async () =>
    await preferenceSettingsPanels().then(
      ({ DevelopmentSettingsUnavailable: component }) => ({
        default: component,
      })
    )
);
type SettingsUser = {
  email: string;
  emailVerified: boolean;
  image?: string | null;
  name: string;
};

export const SettingsScreen = ({
  initialUser,
}: {
  initialUser: SettingsUser;
}) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const routeSearch = settingsRouteApi.useSearch();
  const { tab } = routeSearch;
  const preferences = [
    "overview",
    "appearance",
    "reading",
    "privacy",
    "shortcuts",
  ].includes(tab);
  const title = SETTINGS_TITLES[tab];
  return (
    <SettingsSearch
      key={`${tab}-${routeSearch.organizationId}-${routeSearch.mailboxId}`}
      onSelect={() => {
        setIsMobileOpen(false);
      }}
    >
      {({ input, results, searching }) => (
        <div className="pt-safe pr-safe pb-safe pl-safe relative isolate flex h-dvh min-h-0 overflow-hidden text-fg lg:p-0">
          <SettingsDataPrefetch tab={tab} />
          <BillingCheckoutResult />
          <ConnectorConnectionResult />
          <GmailConnectionResult />
          <WorkspaceSidebar
            isMobileOpen={isMobileOpen}
            onMobileOpenChange={setIsMobileOpen}
            label="Settings sidebar"
          >
            {(close) => (
              <SettingsSidebar
                onRequestClose={close}
                searchInput={input}
                searchResults={close ? results : null}
              />
            )}
          </WorkspaceSidebar>
          <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            <WorkspaceSection>
              <div className="px-4 pt-3 lg:hidden">
                <IconButtonTooltip label="Open settings menu">
                  <Button
                    aria-label="Open settings menu"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      setIsMobileOpen(true);
                    }}
                  >
                    <HugeiconsIcon
                      icon={Menu01Icon}
                      className="size-4"
                      strokeWidth={1.5}
                    />
                  </Button>
                </IconButtonTooltip>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-180 space-y-8 px-5 py-8 md:px-8 md:py-14">
                  {!isMobileOpen && results}
                  <div hidden={searching} className="space-y-8">
                    <SettingsBreadcrumbs />
                    {tab !== "organization" && tab !== "mailboxes" && (
                      <SettingsPageHeader title={title} />
                    )}
                    <Suspense
                      fallback={
                        <SettingsLoadingState
                          className="min-h-64"
                          label={`Loading ${title ?? "settings"}`}
                        />
                      }
                    >
                      {preferences && <PreferencesSettingsPanel />}
                      {tab === "ai" && <AiSettingsPanel />}
                      {tab === "development" &&
                        (isDemoModeAvailable() ? (
                          <DevelopmentSettingsPanel />
                        ) : (
                          <DevelopmentSettingsUnavailable />
                        ))}
                      {tab === "account" && (
                        <AccountSettingsPanel initialUser={initialUser} />
                      )}
                      {tab === "mailboxes" && <MailboxesSettingsPanel />}
                      {tab === "connectors" && <ConnectorsSettingsPanel />}
                      {tab === "organization" && <OrganizationSettingsPanel />}
                    </Suspense>
                  </div>
                </div>
              </div>
            </WorkspaceSection>
          </main>
        </div>
      )}
    </SettingsSearch>
  );
};
