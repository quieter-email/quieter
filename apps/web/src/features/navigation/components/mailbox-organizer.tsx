"use client";

import { ArrowLeft02Icon, Edit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
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
import {
  SavedViewsSection,
  MailboxSavedViewsPanel,
  MailboxSavedViewEditDialog,
} from "./mailbox-saved-views";

const MailboxOrganizerSidebar = (props: MailboxOrganizerContentProps) => {
  const {
    currentSearch,
    onSearch,
    personalViews,
    searchQuery,
    setIsOpen,
    setRuleQueryDraft,
    sharedViews,
    supportsRules,
    supportsSharedViews,
    views,
  } = props;

  return (
    <div className="flex items-center justify-between">
      <div className="min-w-0 flex-1">
        {supportsSharedViews ? (
          <>
            <SavedViewsSection
              currentSearch={currentSearch}
              emptyMessage="No shared views."
              onSearch={onSearch}
              title="Views"
              views={sharedViews}
            />
            <SavedViewsSection
              currentSearch={currentSearch}
              emptyMessage="No personal views."
              onSearch={onSearch}
              title="My views"
              views={personalViews}
            />
          </>
        ) : (
          <SavedViewsSection
            currentSearch={currentSearch}
            emptyMessage="No saved views yet."
            onSearch={onSearch}
            title="Views"
            views={views}
          />
        )}
      </div>
      <IconButtonTooltip
        label={supportsRules ? "Manage views and rules" : "Manage views"}
      >
        <Button
          aria-label={supportsRules ? "Manage views and rules" : "Manage views"}
          className="mt-4 size-6 self-start text-muted-fg hover:text-fg"
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
  const { isOpen, setIsOpen, supportsRules } = props;

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
          <div
            className={cn("mx-auto grid w-full max-w-4xl gap-10 px-5 py-8", {
              "md:grid-cols-2": supportsRules,
            })}
          >
            <MailboxSavedViewsPanel {...props} />
            {supportsRules ? <ManagedMailboxRulesPanel {...props} /> : null}
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
    <MailboxSavedViewEditDialog {...props} />
  </>
);

export const MailboxOrganizer = (props: MailboxOrganizerProps) => {
  const controller = useMailboxOrganizerController(props);
  return <MailboxOrganizerContent {...props} {...controller} />;
};
