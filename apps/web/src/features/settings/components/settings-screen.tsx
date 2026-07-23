"use client";

import { useNavigate } from "@tanstack/react-router";
import { WorkspaceDitherBackground } from "~/components/workspace-dither-background";
import { isDemoModeAvailable } from "~/features/settings/domain/demo-mode-setting";
import { SETTINGS_DETAIL_TITLES } from "~/features/settings/domain/settings-navigation";
import { type SettingsTab } from "~/features/settings/domain/settings-tab";
import { settingsRouteApi } from "~/lib/route-apis";
import { AccountSettingsPanel } from "./account-settings-panel";
import { ActionsSettingsPanel } from "./actions-settings-panel";
import { AiSettingsPanel } from "./ai-settings-panel";
import { BillingCheckoutResult } from "./billing-checkout-result";
import { ConnectorConnectionResult } from "./connector-connection-result";
import { ConnectorsSettingsPanel } from "./connectors-settings-panel";
import { MailboxesSettingsPanel } from "./mailboxes-settings-panel";
import { OrganizationSettingsPanel } from "./organization-settings-panel";
import {
  AppearanceSettingsPanel,
  DevelopmentSettingsPanel,
  DevelopmentSettingsUnavailable,
  PrivacySettingsPanel,
  ReadingSettingsPanel,
  ShortcutsSettingsPanel,
} from "./preference-settings-panels";
import { SettingsBackButton } from "./settings-layout";
import { SettingsOverviewPanel } from "./settings-overview-panel";

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
  const { domainId, from, mailboxId, organizationId, tab } = settingsRouteApi.useSearch();

  const setTab = (nextTab: SettingsTab) => {
    void navigate({
      replace: true,
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
      replace: true,
      search: (previous) => ({
        ...previous,
        mailboxId: "",
      }),
      to: ".",
    });
  };
  const detail = tab === "overview" ? null : SETTINGS_DETAIL_TITLES[tab];

  return (
    <main className="relative isolate flex h-dvh min-h-0 flex-col overflow-hidden bg-background-dark text-foreground">
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
            <SettingsOverviewPanel initialUser={initialUser} onSelectTab={setTab} />
          ) : (
            <div className="space-y-8">
              {detail && tab !== "actions" && tab !== "mailboxes" && (
                <header>
                  <h1 className="text-xl font-normal tracking-tight text-foreground">
                    {detail.title}
                  </h1>
                </header>
              )}

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
            </div>
          )}
        </div>
      </div>
    </main>
  );
};
