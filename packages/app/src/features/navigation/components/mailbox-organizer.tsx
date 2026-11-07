"use client";

import { MailSubviewHeader } from "@quieter/app/features/mailbox/components/mail-subview-header";
import { useMailboxOrganizerController } from "@quieter/app/features/navigation/components/mailbox-organizer-state";
import type { MailboxOrganizerProps } from "@quieter/app/features/navigation/components/mailbox-organizer-types";
import { ManagedMailboxRulesPanel } from "@quieter/app/features/navigation/components/mailbox-rules-panel";
import { Text } from "@quieter/ui/text";

export const MailboxOrganizer = (props: MailboxOrganizerProps) => {
  const controller = useMailboxOrganizerController(props);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
        <div>
          <MailSubviewHeader
            onOpenSidebar={props.onOpenSidebar}
            title="Organize mailbox"
          />
          <Text className="mt-2" tone="muted">
            Automatically organize incoming mail with rules that run in order.
          </Text>
        </div>
        <ManagedMailboxRulesPanel {...props} {...controller} />
      </div>
    </div>
  );
};
