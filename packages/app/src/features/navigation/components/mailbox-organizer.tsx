"use client";

import { ArrowLeft02Icon, Edit01Icon } from "@hugeicons/core-free-icons";
import { useMailboxOrganizerController } from "@quieter/app/features/navigation/components/mailbox-organizer-state";
import type {
  MailboxOrganizerContentProps,
  MailboxOrganizerProps,
} from "@quieter/app/features/navigation/components/mailbox-organizer-types";
import { ManagedMailboxRulesPanel } from "@quieter/app/features/navigation/components/mailbox-rules-panel";
import { Button } from "@quieter/ui/button";
import {
  FullPageDialog,
  FullPageDialogBody,
  FullPageDialogClose,
  FullPageDialogContent,
  FullPageDialogHeader,
  FullPageDialogTitle,
} from "@quieter/ui/full-page-dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";

const MailboxOrganizerSidebar = (props: MailboxOrganizerContentProps) => {
  const { searchQuery, setIsOpen, setRuleQueryDraft } = props;

  return (
    <div className="flex justify-end">
      <IconButtonTooltip label="Manage rules">
        <Button
          aria-label="Manage rules"
          className="mt-4"
          onClick={() => {
            setRuleQueryDraft(searchQuery);
            setIsOpen(true);
          }}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <Icon aria-hidden size={14} icon={Edit01Icon} />
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
              <Icon aria-hidden icon={ArrowLeft02Icon} />
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
    {props.showTrigger !== false && <MailboxOrganizerSidebar {...props} />}
    <MailboxOrganizerFullPageDialog {...props} />
  </>
);

export const MailboxOrganizer = (props: MailboxOrganizerProps) => {
  const controller = useMailboxOrganizerController(props);
  return <MailboxOrganizerContent {...props} {...controller} />;
};
