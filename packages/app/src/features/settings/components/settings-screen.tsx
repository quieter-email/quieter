"use client";

import { Menu01Icon } from "@hugeicons/core-free-icons";
import { BillingCheckoutResult } from "@quieter/app/features/settings/components/billing-checkout-result";
import { ConnectorConnectionResult } from "@quieter/app/features/settings/components/connector-connection-result";
import { GmailConnectionResult } from "@quieter/app/features/settings/components/gmail-connection-result";
import { SettingsBreadcrumbs } from "@quieter/app/features/settings/components/settings-breadcrumbs";
import { SettingsDataPrefetch } from "@quieter/app/features/settings/components/settings-data-prefetch";
import {
  SettingsLoadingState,
  SettingsPageHeader,
} from "@quieter/app/features/settings/components/settings-layout";
import {
  loadAccountBillingPanel,
  loadAccountSettingsPanel,
  loadAiSettingsPanel,
  loadConnectorsSettingsPanel,
  loadMailboxesSettingsPanel,
  loadOrganizationSettingsPanel,
  loadPreferenceSettingsPanels,
} from "@quieter/app/features/settings/components/settings-prefetch";
import { SettingsSearch } from "@quieter/app/features/settings/components/settings-search";
import { SettingsSidebar } from "@quieter/app/features/settings/components/settings-sidebar";
import { isDemoModeAvailable } from "@quieter/app/features/settings/domain/demo-mode-setting";
import { SETTINGS_TITLES } from "@quieter/app/features/settings/domain/settings-navigation";
import { authClient } from "@quieter/app/lib/auth";
import {
  canPrefetchInBackground,
  scheduleBackgroundPrefetch,
  warmInboxDestination,
} from "@quieter/app/lib/background-prefetch";
import { usePreviewPersona } from "@quieter/app/lib/preview-personas";
import { settingsRouteApi } from "@quieter/app/lib/route-apis";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { WorkspaceSection } from "@quieter/ui/workspace-section";
import { WorkspaceSidebar } from "@quieter/ui/workspace-sidebar";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";

const AccountSettingsPanel = lazy(loadAccountSettingsPanel);
const AccountBillingPanel = lazy(loadAccountBillingPanel);
const AiSettingsPanel = lazy(loadAiSettingsPanel);
const ConnectorsSettingsPanel = lazy(loadConnectorsSettingsPanel);
const MailboxesSettingsPanel = lazy(loadMailboxesSettingsPanel);
const OrganizationSettingsPanel = lazy(loadOrganizationSettingsPanel);

const PreferencesSettingsPanel = lazy(
  async () =>
    await loadPreferenceSettingsPanels().then(
      ({ PreferencesSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const DevelopmentSettingsPanel = lazy(
  async () =>
    await loadPreferenceSettingsPanels().then(
      ({ DevelopmentSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const DevelopmentSettingsUnavailable = lazy(
  async () =>
    await loadPreferenceSettingsPanels().then(
      ({ DevelopmentSettingsUnavailable: component }) => ({
        default: component,
      })
    )
);
type SettingsUser = {
  email: string;
  emailVerified: boolean;
  id: string;
  image?: string | null;
  name: string;
};

export const SettingsScreen = ({
  initialUser,
  renderInternalNavigation,
}: {
  initialUser: SettingsUser;
  renderInternalNavigation?: (onRequestClose?: () => void) => ReactNode;
}) => {
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = authClient.useSession();
  const preview = usePreviewPersona();
  const routeSearch = settingsRouteApi.useSearch();
  const { from, tab } = routeSearch;
  const userId = session.data?.user.id ?? initialUser.id;
  useEffect(
    () =>
      scheduleBackgroundPrefetch(queryClient, async (signal) => {
        await Promise.allSettled([
          warmInboxDestination({
            from,
            isSandboxMode: preview !== null,
            queryClient,
            router,
            signal,
            userId,
          }),
          loadPreferenceSettingsPanels(),
        ]);
        for (const load of [
          loadAccountSettingsPanel,
          loadAccountBillingPanel,
          loadMailboxesSettingsPanel,
          loadOrganizationSettingsPanel,
          loadConnectorsSettingsPanel,
          loadAiSettingsPanel,
        ]) {
          if (signal.aborted || !canPrefetchInBackground()) {
            return;
          }
          await Promise.allSettled([load()]);
        }
      }),
    [from, preview, queryClient, router, userId]
  );
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
                internalNavigation={renderInternalNavigation?.(close)}
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
                    <Icon icon={Menu01Icon} />
                  </Button>
                </IconButtonTooltip>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-180 space-y-6 px-5 py-8 md:px-8 md:py-14">
                  {!isMobileOpen && results}
                  <div hidden={searching} className="space-y-6">
                    <SettingsBreadcrumbs />
                    {tab !== "organization" &&
                      tab !== "mailboxes" &&
                      tab !== "connectors" && (
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
                      {tab === "billing" && <AccountBillingPanel />}
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
