"use client";

import { AddMailboxSettingsView } from "#/features/settings/components/add-mailbox-settings-view";
import { MailboxDetailSettingsView } from "#/features/settings/components/mailbox-detail-settings-view";
import { MailboxesListSettingsView } from "#/features/settings/components/mailboxes-list-settings-view";
import { settingsRouteApi } from "#/lib/route-apis";

export const MailboxesSettingsPanel = () => {
  const navigate = settingsRouteApi.useNavigate();
  const { mailboxId, mailboxView } = settingsRouteApi.useSearch();
  const navigateToMailbox = async (nextMailboxId: string) => {
    await navigate({
      search: (previous) => ({
        ...previous,
        mailboxId: nextMailboxId,
        mailboxView: "list",
        tab: "mailboxes",
      }),
      to: ".",
    });
  };
  const selectedMailboxId = mailboxId ?? "";
  if (mailboxView === "add") {
    return <AddMailboxSettingsView onNavigateToMailbox={navigateToMailbox} />;
  }
  if (selectedMailboxId === "") {
    return (
      <MailboxesListSettingsView onNavigateToMailbox={navigateToMailbox} />
    );
  }
  return <MailboxDetailSettingsView mailboxId={selectedMailboxId} />;
};
