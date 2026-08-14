"use client";

import { MailboxDetailSettingsView } from "#/features/settings/components/mailbox-detail-settings-view";
import { MailboxesListSettingsView } from "#/features/settings/components/mailboxes-list-settings-view";
import { settingsRouteApi } from "#/lib/route-apis";

export const MailboxesSettingsPanel = () => {
  const { mailboxId } = settingsRouteApi.useSearch();
  const selectedMailboxId = mailboxId ?? "";
  if (selectedMailboxId === "") {
    return <MailboxesListSettingsView />;
  }
  return <MailboxDetailSettingsView mailboxId={selectedMailboxId} />;
};
