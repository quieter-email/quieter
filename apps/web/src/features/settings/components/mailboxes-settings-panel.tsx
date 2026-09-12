"use client";

import { AddMailboxSettingsView } from "#/features/settings/components/add-mailbox-settings-view";
import { MailboxDetailSettingsView } from "#/features/settings/components/mailbox-detail-settings-view";
import { MailboxesListSettingsView } from "#/features/settings/components/mailboxes-list-settings-view";
import { settingsRouteApi } from "#/lib/route-apis";

import { SettingsBackButton } from "./settings-layout";
import { useSettingsTeam } from "./use-settings-team";

export const MailboxesSettingsPanel = () => {
  const navigate = settingsRouteApi.useNavigate();
  const { mailboxId, mailboxView } = settingsRouteApi.useSearch();
  const navigateToMailbox = async (nextMailboxId: string) => {
    await navigate({
      search: (previous) => ({
        ...previous,
        mailboxId: nextMailboxId,
        mailboxView: "list",
        section: "",
        tab: "mailboxes",
      }),
      to: ".",
    });
  };
  const { teamId, team } = useSettingsTeam();
  const selectedMailboxId = mailboxId ?? "";
  if (mailboxView === "add") {
    return (
      <AddMailboxSettingsView
        key={teamId}
        onNavigateToMailbox={navigateToMailbox}
      />
    );
  }
  if (selectedMailboxId === "") {
    return (
      <MailboxesListSettingsView onNavigateToMailbox={navigateToMailbox} />
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-caption text-muted-fg">
        <span>{team?.name}</span>
        <span>/</span>
        <SettingsBackButton
          onClick={() => {
            void navigate({
              search: (previous) => ({
                ...previous,
                mailboxId: "",
                organizationId: teamId,
                section: "",
              }),
              to: ".",
            });
          }}
        >
          Mailboxes
        </SettingsBackButton>
      </div>
      <MailboxDetailSettingsView
        key={selectedMailboxId}
        mailboxId={selectedMailboxId}
      />
    </div>
  );
};
