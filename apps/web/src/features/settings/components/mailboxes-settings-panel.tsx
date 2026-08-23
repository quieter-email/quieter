"use client";

import { AddMailboxSettingsView } from "#/features/settings/components/add-mailbox-settings-view";
import { MailboxDetailSettingsView } from "#/features/settings/components/mailbox-detail-settings-view";
import { MailboxesListSettingsView } from "#/features/settings/components/mailboxes-list-settings-view";
import { settingsRouteApi } from "#/lib/route-apis";

export const MailboxesSettingsPanel = () => {
  const { mailboxId, mailboxView } = settingsRouteApi.useSearch();
  const selectedMailboxId = mailboxId ?? "";
  if (mailboxView === "add") {
    return <AddMailboxSettingsView />;
  }
  if (selectedMailboxId === "") {
    return <MailboxesListSettingsView />;
  }
  return <MailboxDetailSettingsView mailboxId={selectedMailboxId} />;
};
