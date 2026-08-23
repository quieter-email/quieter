"use client";

import { cn } from "@quieter/ui/cn";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { WorkspaceDitherBackground } from "#/components/workspace-dither-background";
import { isDemoModeAvailable } from "#/features/settings/domain/demo-mode-setting";
import { SETTINGS_DETAIL_TITLES } from "#/features/settings/domain/settings-navigation";
import type { SettingsTab } from "#/features/settings/domain/settings-tab";
import { settingsRouteApi } from "#/lib/route-apis";

import { BillingCheckoutResult } from "./billing-checkout-result";
import { ConnectorConnectionResult } from "./connector-connection-result";
import { SettingsDataPrefetch } from "./settings-data-prefetch";
import { SettingsBackButton, SettingsLoadingState } from "./settings-layout";
import { SettingsOverviewPanel } from "./settings-overview-panel";
import { prefetchSettingsTab } from "./settings-prefetch";
import { SettingsSearch } from "./settings-search";

const AccountSettingsPanel = lazy(
  async () =>
    await import("./account-settings-panel").then(
      ({ AccountSettingsPanel: component }) => ({
        default: component,
      })
    )
);
const ActionsSettingsPanel = lazy(
  async () =>
    await import("./actions-settings-panel").then(
      ({ ActionsSettingsPanel: component }) => ({
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

const preloadSettingsPanel = async (tab: SettingsTab) => {
  switch (tab) {
    case "account": {
      return await import("./account-settings-panel");
    }
    case "actions": {
      return await import("./actions-settings-panel");
    }
    case "ai": {
      return await import("./ai-settings-panel");
    }
    case "connectors": {
      return await import("./connectors-settings-panel");
    }
    case "mailboxes": {
      return await import("./mailboxes-settings-panel");
    }
    case "organization": {
      return await import("./organization-settings-panel");
    }
    case "appearance":
    case "development":
    case "privacy":
    case "reading":
    case "shortcuts": {
      return await preferenceSettingsPanels();
    }
    case "overview": {
      return null;
    }
    default: {
      throw new Error("Unsupported settings tab.");
    }
  }
};

type SettingsUser = {
  email: string;
  emailVerified: boolean;
  image?: string | null;
  name: string;
};

const SettingsBackNavigation = ({
  domainId,
  mailboxId,
  mailboxView,
  onBackToApp,
  onBackToMailboxes,
  onBackToOverview,
  organizationId,
  tab,
}: {
  domainId: string;
  mailboxId: string;
  mailboxView: "add" | "list";
  onBackToApp: () => void;
  onBackToMailboxes: () => void;
  onBackToOverview: () => void;
  organizationId: string;
  tab: SettingsTab;
}) => {
  if (tab === "overview") {
    return <SettingsBackButton onClick={onBackToApp}>Back</SettingsBackButton>;
  }

  if (tab === "mailboxes" && (mailboxId !== "" || mailboxView === "add")) {
    return (
      <SettingsBackButton onClick={onBackToMailboxes}>
        Mailboxes
      </SettingsBackButton>
    );
  }

  if (tab === "organization" && (organizationId !== "" || domainId !== "")) {
    return null;
  }

  return (
    <SettingsBackButton onClick={onBackToOverview}>Settings</SettingsBackButton>
  );
};

type SettingsScreenProps = {
  initialUser: SettingsUser;
};

export const SettingsScreen = ({ initialUser }: SettingsScreenProps) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate({
    from: "/settings",
  });
  const { domainId, from, mailboxId, mailboxView, organizationId, tab } =
    settingsRouteApi.useSearch();

  const setTab = (nextTab: SettingsTab) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        domainId: "",
        mailboxId: "",
        mailboxView: "list",
        organizationId: "",
        organizationView: "overview",
        tab: nextTab,
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
        mailboxView: "list",
      }),
      to: ".",
    });
  };
  const detail = tab === "overview" ? null : SETTINGS_DETAIL_TITLES[tab];

  return (
    <main
      className={cn(
        "relative isolate flex h-dvh min-h-0 flex-col overflow-hidden text-fg",
        {
          "bg-bg": mailboxView === "add",
          "bg-bg-elevated": mailboxView !== "add",
        }
      )}
    >
      <SettingsDataPrefetch tab={tab} />
      <BillingCheckoutResult />
      <ConnectorConnectionResult />
      <WorkspaceDitherBackground />
      <SettingsBackNavigation
        domainId={domainId}
        mailboxId={mailboxId}
        mailboxView={mailboxView}
        onBackToApp={goBackToApp}
        onBackToMailboxes={goBackToMailboxes}
        onBackToOverview={() => {
          setTab("overview");
        }}
        organizationId={organizationId}
        tab={tab}
      />
      <SettingsSearch
        onPrefetchTab={(nextTab) => {
          void prefetchSettingsTab(queryClient, nextTab);
          void preloadSettingsPanel(nextTab);
        }}
        onSelectTab={setTab}
      />
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
                  <h1 className="text-title-sm font-normal tracking-tight text-fg">
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
                {tab === "account" && (
                  <AccountSettingsPanel initialUser={initialUser} />
                )}
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
