"use client";

import { ArrowLeft02Icon, Edit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import {
  FullPageDialog,
  FullPageDialogBody,
  FullPageDialogClose,
  FullPageDialogContent,
  FullPageDialogHeader,
  FullPageDialogTitle,
} from "@quieter/ui/full-page-dialog";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";

import { useMailboxOrganizerController } from "./mailbox-organizer-state";
import type {
  MailboxOrganizerContentProps,
  MailboxOrganizerProps,
} from "./mailbox-organizer-types";
import { ManagedMailboxRulesPanel } from "./mailbox-rules-panel";

const MailboxOrganizerSidebar = (props: MailboxOrganizerContentProps) => {
  const { searchQuery, setIsOpen, setRuleQueryDraft } = props;

  return (
    <div className="flex justify-end">
      <IconButtonTooltip label="Manage rules">
        <Button
          aria-label="Manage rules"
          className="mt-4 size-6 text-muted-fg hover:text-fg"
          onClick={() => {
            setRuleQueryDraft(searchQuery);
            setIsOpen(true);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden className="size-3.5" icon={Edit01Icon} />
        </Button>
      </IconButtonTooltip>
    </div>
  );
};

const MailboxOrganizerFullPageDialog = (
  props: MailboxOrganizerContentProps
) => {
  const { isOpen, setIsOpen } = props;

  return (
    <FullPageDialog onOpenChange={setIsOpen} open={isOpen}>
      <FullPageDialogContent>
        <FullPageDialogHeader>
          <IconButtonTooltip label="Close organizer">
            <FullPageDialogClose aria-label="Close organizer">
              <HugeiconsIcon aria-hidden icon={ArrowLeft02Icon} />
            </FullPageDialogClose>
          </IconButtonTooltip>
          <FullPageDialogTitle>Organize mailbox</FullPageDialogTitle>
        </FullPageDialogHeader>
        <FullPageDialogBody>
          <div className="mx-auto grid w-full max-w-2xl gap-10 px-5 py-8">
            <ManagedMailboxRulesPanel {...props} />
          </div>
        </FullPageDialogBody>
      </FullPageDialogContent>
    </FullPageDialog>
  );
};

const MailboxOrganizerContent = (props: MailboxOrganizerContentProps) => (
  <>
    <MailboxOrganizerSidebar {...props} />
    <MailboxOrganizerFullPageDialog {...props} />
  </>
);

export const MailboxOrganizer = (props: MailboxOrganizerProps) => {
  const controller = useMailboxOrganizerController(props);
  return <MailboxOrganizerContent {...props} {...controller} />;
};
