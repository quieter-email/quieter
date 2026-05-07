"use client";

import { useNavigate } from "@tanstack/react-router";
import { type SettingsTab } from "~/features/settings/domain/settings-tab";
import { settingsRouteApi } from "~/lib/route-apis";
import { AccountSettingsPanel } from "./account-settings-panel";
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

  const setTab = (nextTab: SettingsTab) => {
    void navigate({
      replace: true,
      search: (previous) => ({
        ...previous,
        tab: nextTab,
        teamId: "",
        teamView: "overview",
      }),
      to: ".",
    });
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col px-4 py-6 sm:px-6 md:grid md:h-dvh md:grid-cols-[auto_1fr] md:py-20">
      <SettingsSidebar
        activeTab={tab}
        onBack={() => {
          void navigate({
            to: from,
          });
        }}
        onSelectTab={setTab}
      />

      <main className="min-h-0 flex-1 overflow-y-auto pt-8 md:h-full md:pt-20 md:pr-6">
        {tab === "general" && <GeneralSettingsPanel />}
        {tab === "account" && <AccountSettingsPanel initialUser={initialUser} />}
        {tab === "mailboxes" && <MailboxesSettingsPanel />}
        {tab === "organization" && <OrganizationSettingsPanel />}
      </main>
    </div>
  );
};
