"use client";

import {
  Add01Icon,
  Delete02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import type { ReactNode } from "react";

import type {
  MailboxActionDetail,
  MailboxActionListItem,
} from "./action-editor-types";
import type { MailboxOption } from "./action-simple-editor";
import {
  SettingsCard,
  SettingsRow,
  SettingsRowText,
  SettingsRows,
  SettingsSection,
  settingsSurfaceVariants,
} from "./settings-layout";

const getSavedActionsDescription = (
  actionCount: number,
  actionsLoading: boolean
) => {
  if (actionCount > 0) {
    return "Choose an action to edit, or create another one.";
  }
  if (actionsLoading) {
    return "Loading saved actions.";
  }
  return "No actions yet.";
};

const ActionEditorStatus = ({
  action,
  hasPublished,
  isPublishing,
  isSaving,
  onPublish,
  onSave,
  onSetEnabled,
  publishDisabled,
  statusDescription,
}: {
  action: MailboxActionDetail;
  hasPublished: boolean;
  isPublishing: boolean;
  isSaving: boolean;
  onPublish: () => void;
  onSave: () => void;
  onSetEnabled: (enabled: boolean) => void;
  publishDisabled: boolean;
  statusDescription: string;
}) => (
  <SettingsRows>
    <SettingsRow
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={isSaving}
            onClick={onSave}
            size="sm"
            type="button"
            variant="outline"
          >
            {isSaving ? (
              <HugeiconsIcon
                aria-hidden
                className="size-4 animate-spin"
                icon={Loading03Icon}
              />
            ) : null}
            Save
          </Button>
          <Button
            disabled={publishDisabled}
            onClick={onPublish}
            size="sm"
            type="button"
          >
            {isPublishing ? (
              <HugeiconsIcon
                aria-hidden
                className="size-4 animate-spin"
                icon={Loading03Icon}
              />
            ) : null}
            Publish
          </Button>
          <Switch
            aria-label="Enable action"
            checked={action.enabled}
            disabled={!hasPublished}
            onCheckedChange={onSetEnabled}
          >
            <SwitchThumb />
          </Switch>
        </div>
      }
      title="Status"
    >
      {statusDescription}
    </SettingsRow>
  </SettingsRows>
);

export const ActionEditorRuleSection = ({
  action,
  fields,
  hasPublished,
  isPublishing,
  isSaving,
  onPublish,
  onSave,
  onSetEnabled,
  publishDisabled,
  statusDescription,
  validationErrors,
}: {
  action: MailboxActionDetail;
  fields: ReactNode;
  hasPublished: boolean;
  isPublishing: boolean;
  isSaving: boolean;
  onPublish: () => void;
  onSave: () => void;
  onSetEnabled: (enabled: boolean) => void;
  publishDisabled: boolean;
  statusDescription: string;
  validationErrors: string[];
}) => (
  <SettingsSection title="Rule">
    <SettingsCard>{fields}</SettingsCard>

    {validationErrors.length > 0 ? (
      <SettingsCard className="border-destructive/35 bg-destructive/5 p-4">
        <p className={settingsSurfaceVariants({ variant: "title" })}>
          Missing before publish
        </p>
        <ul className="mt-2 space-y-1 text-body text-destructive">
          {validationErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </SettingsCard>
    ) : null}

    <ActionEditorStatus
      action={action}
      hasPublished={hasPublished}
      isPublishing={isPublishing}
      isSaving={isSaving}
      onPublish={onPublish}
      onSave={onSave}
      onSetEnabled={onSetEnabled}
      publishDisabled={publishDisabled}
      statusDescription={statusDescription}
    />
  </SettingsSection>
);

export const ActionEditorEmptyState = ({
  createDisabled,
  isCreating,
  onCreate,
}: {
  createDisabled: boolean;
  isCreating: boolean;
  onCreate: () => void;
}) => (
  <SettingsCard className="p-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <SettingsRowText title="No action selected">
        Create an action to define what should happen when new mail arrives.
      </SettingsRowText>
      <Button
        disabled={createDisabled}
        onClick={onCreate}
        size="sm"
        type="button"
      >
        {isCreating ? (
          <HugeiconsIcon
            aria-hidden
            className="size-4 animate-spin"
            icon={Loading03Icon}
          />
        ) : (
          <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
        )}
        New action
      </Button>
    </div>
  </SettingsCard>
);

export const ActionEditorMailboxSection = ({
  activeMailbox,
  activeMailboxId,
  mailboxesLoading,
  mailboxOptions,
  onSelectMailbox,
}: {
  activeMailbox: MailboxOption | undefined;
  activeMailboxId: string | undefined;
  mailboxesLoading: boolean;
  mailboxOptions: MailboxOption[];
  onSelectMailbox: (mailboxId: string) => void;
}) => (
  <SettingsSection title="Mailbox">
    <SettingsRows>
      <SettingsRow
        action={
          <Select
            items={mailboxOptions.map((mailbox) => ({
              label: mailbox.label,
              value: mailbox.id,
            }))}
            onValueChange={(value) => {
              if (value === null || value === undefined || value === "") {
                return;
              }
              onSelectMailbox(value);
            }}
            value={activeMailboxId ?? ""}
          >
            <SelectTrigger
              aria-label="Mailbox"
              className="w-64"
              disabled={mailboxesLoading || mailboxOptions.length === 0}
              size="sm"
            >
              <SelectValue placeholder="Select mailbox" />
            </SelectTrigger>
            <SelectContent align="end">
              {mailboxOptions.map((mailbox) => (
                <SelectItem key={mailbox.id} value={mailbox.id}>
                  {mailbox.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        title="Mailbox"
      >
        {activeMailbox
          ? `Actions run only for new mail in ${activeMailbox.label}.`
          : "Choose a Gmail or managed mailbox."}
      </SettingsRow>
    </SettingsRows>
  </SettingsSection>
);

export const ActionEditorSavedActionsSection = ({
  action,
  actions,
  actionsLoading,
  activeActionId,
  createDisabled,
  createActionPending,
  deleteDisabled,
  deleteOpen,
  deletePending,
  onCreateAction,
  onDeleteAction,
  onOpenDelete,
  onSelectAction,
  setDeleteOpen,
}: {
  action: MailboxActionDetail | undefined;
  actions: MailboxActionListItem[];
  actionsLoading: boolean;
  activeActionId: string | undefined;
  createDisabled: boolean;
  createActionPending: boolean;
  deleteDisabled: boolean;
  deleteOpen: boolean;
  deletePending: boolean;
  onCreateAction: () => void;
  onDeleteAction: () => void;
  onOpenDelete: () => void;
  onSelectAction: (actionId: string) => void;
  setDeleteOpen: (open: boolean) => void;
}) => (
  <SettingsSection
    description="Each action is one plain-language instruction that runs after the selected trigger."
    title="Action"
  >
    <SettingsRows>
      <SettingsRow
        action={
          <div className="flex items-center gap-2">
            <Button
              disabled={createDisabled || createActionPending}
              onClick={onCreateAction}
              size="sm"
              type="button"
              variant="outline"
            >
              {createActionPending ? (
                <HugeiconsIcon
                  aria-hidden
                  className="size-4 animate-spin"
                  icon={Loading03Icon}
                />
              ) : (
                <HugeiconsIcon
                  aria-hidden
                  className="size-4"
                  icon={Add01Icon}
                />
              )}
              New action
            </Button>
            <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
              <IconButtonTooltip label="Delete action">
                <Button
                  aria-label="Delete action"
                  disabled={deleteDisabled || deletePending}
                  onClick={onOpenDelete}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <HugeiconsIcon
                    aria-hidden
                    className="size-4 text-destructive"
                    icon={Delete02Icon}
                  />
                </Button>
              </IconButtonTooltip>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this action?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the action and its saved versions for this
                    mailbox.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogBody>
                  <p className="text-body text-muted-fg">
                    This cannot be undone.
                  </p>
                </AlertDialogBody>
                <AlertDialogFooter>
                  <AlertDialogCloseButton disabled={deletePending}>
                    Cancel
                  </AlertDialogCloseButton>
                  <Button
                    disabled={deletePending}
                    onClick={onDeleteAction}
                    type="button"
                    variant="destructive"
                  >
                    Delete
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        }
        title="Saved actions"
      >
        {getSavedActionsDescription(actions.length, actionsLoading)}
      </SettingsRow>
      {actions.length > 0 ? (
        <SettingsRow
          action={
            <Select
              items={actions.map((item) => ({
                label: item.name,
                value: item.id,
              }))}
              onValueChange={(value) => {
                if (value === null || value === undefined || value === "") {
                  return;
                }
                onSelectAction(value);
              }}
              value={activeActionId ?? ""}
            >
              <SelectTrigger aria-label="Action" className="w-64" size="sm">
                <SelectValue placeholder="Select action" />
              </SelectTrigger>
              <SelectContent align="end">
                {actions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          title="Current action"
        >
          {action?.enabled === true
            ? "Published and enabled."
            : "Draft or disabled."}
        </SettingsRow>
      ) : null}
    </SettingsRows>
  </SettingsSection>
);
