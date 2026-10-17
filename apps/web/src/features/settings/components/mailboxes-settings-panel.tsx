"use client";

import { AddMailboxSettingsView } from "#/features/settings/components/add-mailbox-settings-view";
import { MailboxDetailSettingsView } from "#/features/settings/components/mailbox-detail-settings-view";
import { MailboxesListSettingsView } from "#/features/settings/components/mailboxes-list-settings-view";
import { settingsRouteApi } from "#/lib/route-apis";

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
  const { teamId } = useSettingsTeam();
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
    <MailboxDetailSettingsView
      key={selectedMailboxId}
      mailboxId={selectedMailboxId}
    />
  );
};
