"use client";

import { useNavigate, useRouter } from "@tanstack/react-router";
import { settingsRouteApi } from "~/lib/route-apis";
import { toSettingsSearch, type SettingsTab } from "~/lib/search-params";
import { AccountSettingsPanel } from "./settings/account-settings-panel";
import { GeneralSettingsPanel } from "./settings/general-settings-panel";
import { MailboxesSettingsPanel } from "./settings/mailboxes-settings-panel";
import { OrganizationSettingsPanel } from "./settings/organization-settings-panel";
import { SettingsSidebar } from "./settings/settings-sidebar";

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
  const router = useRouter();
  const { from, tab } = settingsRouteApi.useSearch();
  const activeTab = tab;
  const backTarget = from;

  const setTab = (nextTab: SettingsTab) => {
    void navigate({
      replace: true,
      resetScroll: false,
      search: (previous) =>
        toSettingsSearch({
          ...previous,
          tab: nextTab,
        }),
      to: ".",
    });
  };

  return (
    <div className="mx-auto grid h-dvh max-w-4xl grid-cols-[auto_1fr] py-20">
      <SettingsSidebar
        activeTab={activeTab}
        onBack={() => {
          router.history.push(backTarget);
        }}
        onSelectTab={setTab}
      />

      <main className="h-full overflow-y-auto pt-20 pr-6">
        {activeTab === "general" && <GeneralSettingsPanel />}

        {activeTab === "account" && <AccountSettingsPanel initialUser={initialUser} />}

        {activeTab === "mailboxes" && <MailboxesSettingsPanel />}

        {activeTab === "organization" && <OrganizationSettingsPanel />}
      </main>
    </div>
  );
};
