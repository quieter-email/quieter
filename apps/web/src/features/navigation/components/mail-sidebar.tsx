"use client";

import { Edit01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, LinkButton } from "@quieter/ui";
import type { MailboxCategory } from "~/lib/gmail/gmail";
import { MailboxSwitcherDropdown } from "~/features/navigation/components/mailbox-switcher";
import { SidebarMailboxNav } from "~/features/navigation/components/sidebar-mailbox-nav";

type MailSidebarProps = {
  defaultMailboxId: string | null;
  mailboxes: Array<{
    id: string;
    emailAddress: string;
    displayName: string | null;
    provider: string;
  }>;
  selectedMailboxId: string | null;
  selectedMailbox: MailboxCategory;
  onSelectMailbox: (mailbox: MailboxCategory) => void;
  onSelectMailboxId: (mailboxId: string) => void;
  onSetDefaultMailbox: (mailboxId: string | null) => void;
  onComposeNewMail: () => void;
  workspaceName: string;
};

export const MailSidebar = ({
  defaultMailboxId,
  mailboxes,
  onComposeNewMail,
  onSelectMailbox,
  onSelectMailboxId,
  onSetDefaultMailbox,
  selectedMailboxId,
  selectedMailbox,
  workspaceName,
}: MailSidebarProps) => {
  return (
    <aside
      className="relative hidden h-full shrink-0 bg-background text-foreground lg:flex lg:flex-col"
      style={{ width: "248px" }}
    >
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-6 pb-4">
        <div className="min-w-0 rounded-md px-5">
          <MailboxSwitcherDropdown
            defaultMailboxId={defaultMailboxId}
            mailboxes={mailboxes}
            onSelectMailboxId={onSelectMailboxId}
            onSetDefaultMailbox={onSetDefaultMailbox}
            selectedMailboxId={selectedMailboxId}
            workspaceName={workspaceName}
          />
        </div>

        <div className="mt-4 p-1">
          <Button
            className="w-full justify-start rounded-md px-4"
            disabled={!selectedMailboxId}
            onClick={onComposeNewMail}
            type="button"
          >
            <HugeiconsIcon className="size-4 shrink-0" icon={Edit01Icon} />
            Compose
          </Button>
        </div>

        <div className="mt-4 min-h-0 flex-1 p-1">
          <SidebarMailboxNav onSelectMailbox={onSelectMailbox} selectedMailbox={selectedMailbox} />
        </div>
        <div className="mt-auto p-2">
          <LinkButton
            aria-label="Settings"
            className="w-full justify-start"
            search={{
              from: "/",
              tab: "general",
            }}
            variant="ghost"
            to="/settings"
          >
            <HugeiconsIcon className="size-4 shrink-0" icon={Settings01Icon} />
            Settings
          </LinkButton>
        </div>
      </div>
    </aside>
  );
};
