"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { isDemoModeAvailable } from "~/features/settings/domain/demo-mode-setting";
import { SETTINGS_DETAIL_TITLES } from "~/features/settings/domain/settings-navigation";
import { SETTINGS_TABS, type SettingsTab } from "~/features/settings/domain/settings-tab";
import { settingsRouteApi } from "~/lib/route-apis";
import { BillingCheckoutResult } from "./billing-checkout-result";
import { ConnectorConnectionResult } from "./connector-connection-result";
import { SettingsDataPrefetch } from "./settings-data-prefetch";
import { SettingsBackButton, SettingsLoadingState } from "./settings-layout";
import { SettingsOverviewPanel } from "./settings-overview-panel";
import { prefetchSettingsTab } from "./settings-prefetch";

const AccountSettingsPanel = lazy(() =>
  import("./account-settings-panel").then(({ AccountSettingsPanel: component }) => ({
    default: component,
  })),
);
const ActionsSettingsPanel = lazy(() =>
  import("./actions-settings-panel").then(({ ActionsSettingsPanel: component }) => ({
    default: component,
  })),
);
const AiSettingsPanel = lazy(() =>
  import("./ai-settings-panel").then(({ AiSettingsPanel: component }) => ({
    default: component,
  })),
);
const ConnectorsSettingsPanel = lazy(() =>
  import("./connectors-settings-panel").then(({ ConnectorsSettingsPanel: component }) => ({
    default: component,
  })),
);
const MailboxesSettingsPanel = lazy(() =>
  import("./mailboxes-settings-panel").then(({ MailboxesSettingsPanel: component }) => ({
    default: component,
  })),
);
const OrganizationSettingsPanel = lazy(() =>
  import("./organization-settings-panel").then(({ OrganizationSettingsPanel: component }) => ({
    default: component,
  })),
);
const preferenceSettingsPanels = () => import("./preference-settings-panels");
const AppearanceSettingsPanel = lazy(() =>
  preferenceSettingsPanels().then(({ AppearanceSettingsPanel: component }) => ({
    default: component,
  })),
);
const DevelopmentSettingsPanel = lazy(() =>
  preferenceSettingsPanels().then(({ DevelopmentSettingsPanel: component }) => ({
    default: component,
  })),
);
const DevelopmentSettingsUnavailable = lazy(() =>
  preferenceSettingsPanels().then(({ DevelopmentSettingsUnavailable: component }) => ({
    default: component,
  })),
);
const PrivacySettingsPanel = lazy(() =>
  preferenceSettingsPanels().then(({ PrivacySettingsPanel: component }) => ({
    default: component,
  })),
);
const ReadingSettingsPanel = lazy(() =>
  preferenceSettingsPanels().then(({ ReadingSettingsPanel: component }) => ({
    default: component,
  })),
);
const ShortcutsSettingsPanel = lazy(() =>
  preferenceSettingsPanels().then(({ ShortcutsSettingsPanel: component }) => ({
    default: component,
  })),
);

const preloadSettingsPanel = (tab: SettingsTab) => {
  switch (tab) {
    case "account":
      return import("./account-settings-panel");
    case "actions":
      return import("./actions-settings-panel");
    case "ai":
      return import("./ai-settings-panel");
    case "connectors":
      return import("./connectors-settings-panel");
    case "mailboxes":
      return import("./mailboxes-settings-panel");
    case "organization":
      return import("./organization-settings-panel");
    case "appearance":
    case "development":
    case "privacy":
    case "reading":
    case "shortcuts":
      return preferenceSettingsPanels();
    default:
      return Promise.resolve();
  }
};

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
  const queryClient = useQueryClient();
  const navigate = useNavigate({
    from: "/settings",
  });
  const { domainId, from, mailboxId, organizationId, tab } = settingsRouteApi.useSearch();

  const setTab = (nextTab: SettingsTab) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        tab: nextTab,
        mailboxId: "",
        domainId: "",
        organizationId: "",
        organizationView: "overview",
      }),
      to: ".",
    });
  };
  const goBackToApp = () => {
    void navigate({
      to: from,
    });
  };
  const goBackToMailboxes = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        mailboxId: "",
      }),
      to: ".",
    });
  };
  const detail = tab === "overview" ? null : SETTINGS_DETAIL_TITLES[tab];

  useEffect(() => {
    void Promise.all(SETTINGS_TABS.map(preloadSettingsPanel));
  }, []);

  return (
    <main className="relative isolate flex h-dvh min-h-0 flex-col overflow-hidden bg-background-dark text-foreground">
      <SettingsDataPrefetch />
      <BillingCheckoutResult />
      <ConnectorConnectionResult />
      <WorkspaceDitherBackground />
      {tab === "overview" ? (
        <SettingsBackButton onClick={goBackToApp}>Back</SettingsBackButton>
      ) : tab === "mailboxes" && mailboxId ? (
        <SettingsBackButton onClick={goBackToMailboxes}>Mailboxes</SettingsBackButton>
      ) : tab === "organization" && (organizationId || domainId) ? null : (
        <SettingsBackButton onClick={() => setTab("overview")}>Settings</SettingsBackButton>
      )}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-205 px-5 py-8 md:px-8 md:py-14">
          {tab === "overview" ? (
            <SettingsOverviewPanel
              initialUser={initialUser}
              onPrefetchTab={(nextTab) => {
                void prefetchSettingsTab(queryClient, nextTab);
                void preloadSettingsPanel(nextTab);
              }}
              onSelectTab={setTab}
            />
          ) : (
            <div className="space-y-8">
              {detail && tab !== "actions" && tab !== "mailboxes" && (
                <header>
                  <h1 className="text-xl font-normal tracking-tight text-foreground">
                    {detail.title}
                  </h1>
                </header>
              )}

              <Suspense
                fallback={
                  <SettingsLoadingState
                    className="min-h-64"
                    label={`Loading ${detail?.title ?? "settings"}`}
                  />
                }
              >
                {tab === "appearance" && <AppearanceSettingsPanel />}
                {tab === "ai" && <AiSettingsPanel />}
                {tab === "reading" && <ReadingSettingsPanel />}
                {tab === "shortcuts" && <ShortcutsSettingsPanel />}
                {tab === "privacy" && <PrivacySettingsPanel />}
                {tab === "development" &&
                  (isDemoModeAvailable() ? (
                    <DevelopmentSettingsPanel />
                  ) : (
                    <DevelopmentSettingsUnavailable />
                  ))}
                {tab === "account" && <AccountSettingsPanel initialUser={initialUser} />}
                {tab === "mailboxes" && <MailboxesSettingsPanel />}
                {tab === "actions" && <ActionsSettingsPanel />}
                {tab === "connectors" && <ConnectorsSettingsPanel />}
                {tab === "organization" && <OrganizationSettingsPanel />}
              </Suspense>
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
