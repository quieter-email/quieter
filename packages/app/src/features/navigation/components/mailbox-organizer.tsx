"use client";

import { useMailboxOrganizerController } from "@quieter/app/features/navigation/components/mailbox-organizer-state";
import type { MailboxOrganizerProps } from "@quieter/app/features/navigation/components/mailbox-organizer-types";
import { ManagedMailboxRulesPanel } from "@quieter/app/features/navigation/components/mailbox-rules-panel";
import { SettingsPageHeader } from "@quieter/ui/settings-layout";

export const MailboxOrganizer = (props: MailboxOrganizerProps) => {
  const controller = useMailboxOrganizerController(props);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <SettingsPageHeader
          action={props.headerAction}
          title="Organize mailbox"
        >
          Automatically organize incoming mail with rules that run in order.
        </SettingsPageHeader>
        <ManagedMailboxRulesPanel {...props} {...controller} />
      </div>
    </div>
  );
};
