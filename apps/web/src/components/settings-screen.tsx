"use client";

import { useRouter } from "next/navigation";
import { useQueryStates } from "nuqs";
import { settingsSearchParams, type SettingsTab } from "~/lib/search-params";
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
  initialTab: SettingsTab;
  from: string;
  initialUser: SettingsUser;
};

export const SettingsScreen = ({ from, initialTab, initialUser }: SettingsScreenProps) => {
  const router = useRouter();
  const [{ from: queryFrom, tab }, setSettingsQuery] = useQueryStates(settingsSearchParams, {
    history: "replace",
    scroll: false,
  });

  const activeTab = tab || initialTab;
  const backTarget = queryFrom || from;

  const setTab = (nextTab: SettingsTab) => {
    void setSettingsQuery({ tab: nextTab });
  };

  return (
    <div className="mx-auto grid h-dvh max-w-4xl grid-cols-[auto_1fr] py-20">
      <SettingsSidebar
        activeTab={activeTab}
        onBack={() => router.push(backTarget)}
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
