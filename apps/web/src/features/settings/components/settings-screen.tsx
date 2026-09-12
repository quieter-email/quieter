"use client";

import { lazy, Suspense } from "react";

import { isDemoModeAvailable } from "#/features/settings/domain/demo-mode-setting";
import { SETTINGS_TITLES } from "#/features/settings/domain/settings-navigation";
import { settingsRouteApi } from "#/lib/route-apis";

import { BillingCheckoutResult } from "./billing-checkout-result";
import { ConnectorConnectionResult } from "./connector-connection-result";
import { SettingsDataPrefetch } from "./settings-data-prefetch";
import { SettingsLoadingState } from "./settings-layout";
import { SettingsSearch } from "./settings-search";
import { SettingsSidebar } from "./settings-sidebar";

const AccountSettingsPanel = lazy(
  async () =>
    await import("./account-settings-panel").then(
      ({ AccountSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const AiSettingsPanel = lazy(
  async () =>
    await import("./ai-settings-panel").then(
      ({ AiSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const ConnectorsSettingsPanel = lazy(
  async () =>
    await import("./connectors-settings-panel").then(
      ({ ConnectorsSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const MailboxesSettingsPanel = lazy(
  async () =>
    await import("./mailboxes-settings-panel").then(
      ({ MailboxesSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const OrganizationSettingsPanel = lazy(
  async () =>
    await import("./organization-settings-panel").then(
      ({ OrganizationSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const preferenceSettingsPanels = async () =>
  await import("./preference-settings-panels");
const AppearanceSettingsPanel = lazy(
  async () =>
    await preferenceSettingsPanels().then(
      ({ AppearanceSettingsPanel: component }) => ({
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
const PrivacySettingsPanel = lazy(
  async () =>
    await preferenceSettingsPanels().then(
      ({ PrivacySettingsPanel: component }) => ({
        default: component,
      })
    )
);
const ReadingSettingsPanel = lazy(
  async () =>
    await preferenceSettingsPanels().then(
      ({ ReadingSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const ShortcutsSettingsPanel = lazy(
  async () =>
    await preferenceSettingsPanels().then(
      ({ ShortcutsSettingsPanel: component }) => ({
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
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-fg md:flex-row">
      <SettingsDataPrefetch tab={tab} />
      <BillingCheckoutResult />
      <ConnectorConnectionResult />
      <SettingsSidebar />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-240 space-y-8 px-5 py-6 md:px-10 md:py-8">
          <SettingsSearch
            key={`${tab}-${routeSearch.organizationId}-${routeSearch.mailboxId}-${routeSearch.organizationView}`}
          >
            <div className="space-y-8">
              {tab !== "organization" && tab !== "mailboxes" && (
                <h1 className="text-title-sm font-normal tracking-tight">
                  {title}
                </h1>
              )}
              <Suspense
                fallback={
                  <SettingsLoadingState
                    className="min-h-64"
                    label={`Loading ${title ?? "settings"}`}
                  />
                }
              >
                {preferences && (
                  <>
                    <AppearanceSettingsPanel />
                    <ReadingSettingsPanel />
                    <ShortcutsSettingsPanel />
                    <PrivacySettingsPanel />
                  </>
                )}
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
          </SettingsSearch>
        </div>
      </main>
    </div>
  );
};
