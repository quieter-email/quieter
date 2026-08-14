"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useDemoModeEnabled } from "#/features/settings/domain/demo-mode-setting";
import { useManagedDemoModeEnabled } from "#/features/settings/domain/managed-demo-mode-setting";
import { connectorsQueryOptions } from "#/lib/connectors-query";
import {
  mailboxActionQueryOptions,
  mailboxActionsListQueryOptions,
} from "#/lib/mailbox-actions-query";
import { mailboxesQueryOptions } from "#/lib/mailboxes-query";
import { usePreviewPersona } from "#/lib/preview-personas";

import { ActionSimpleEditor } from "./action-simple-editor";
import type { MailboxOption } from "./action-simple-editor";
import {
  SettingsCard,
  SettingsLoadingState,
  SettingsPageHeader,
  SettingsRowText,
} from "./settings-layout";

const getMailboxLabel = (
  displayName: string | null | undefined,
  emailAddress: string
) => {
  const trimmedDisplayName = displayName?.trim() ?? "";
  return trimmedDisplayName === "" ? emailAddress : trimmedDisplayName;
};

const buildMailboxOptions = (
  groups: RouterOutputs["mail"]["listMailboxes"]["groups"]
): MailboxOption[] => {
  const mailboxOptions: MailboxOption[] = [];
  for (const group of groups) {
    for (const mailbox of group.mailboxes) {
      if (mailbox.provider !== "gmail" && mailbox.provider !== "managed") {
        continue;
      }
      mailboxOptions.push({
        emailAddress: mailbox.emailAddress,
        groupName: group.name,
        id: mailbox.id,
        label: getMailboxLabel(mailbox.displayName, mailbox.emailAddress),
        provider: mailbox.provider,
      });
    }
  }
  return mailboxOptions;
};

const renderActionsBody = ({
  actions,
  action,
  actionsLoading,
  activeActionId,
  activeMailbox,
  activeMailboxId,
  connectorsData,
  draftRevision,
  hasActionableMailbox,
  mailboxesLoading,
  mailboxOptions,
  setSelectedActionId,
  setSelectedMailboxId,
  showDemoMailboxHint,
  openMailboxesSettings,
}: {
  actions: RouterOutputs["mailboxActions"]["list"]["actions"];
  action: RouterOutputs["mailboxActions"]["get"]["action"] | undefined;
  actionsLoading: boolean;
  activeActionId: string | undefined;
  activeMailbox: MailboxOption | undefined;
  activeMailboxId: string | undefined;
  connectorsData: RouterOutputs["connectors"]["list"] | undefined;
  draftRevision:
    | RouterOutputs["mailboxActions"]["get"]["revisions"][number]
    | undefined;
  hasActionableMailbox: boolean;
  mailboxesLoading: boolean;
  mailboxOptions: MailboxOption[];
  setSelectedActionId: (actionId: string | undefined) => void;
  setSelectedMailboxId: (mailboxId: string | undefined) => void;
  showDemoMailboxHint: boolean;
  openMailboxesSettings: () => void;
}) => {
  if (mailboxesLoading) {
    return (
      <SettingsLoadingState className="min-h-48" label="Loading actions" />
    );
  }
  if (hasActionableMailbox) {
    return (
      <ActionSimpleEditor
        action={action}
        actions={actions}
        actionsLoading={actionsLoading}
        activeActionId={activeActionId}
        activeMailbox={activeMailbox}
        activeMailboxId={activeMailboxId}
        connectorsData={connectorsData}
        draftRevision={draftRevision}
        key={`${activeActionId ?? "new"}:${draftRevision?.id ?? "empty"}`}
        mailboxesLoading={mailboxesLoading}
        mailboxOptions={mailboxOptions}
        setSelectedActionId={setSelectedActionId}
        setSelectedMailboxId={setSelectedMailboxId}
      />
    );
  }
  return (
    <SettingsCard className="p-6">
      <div className="space-y-4">
        <SettingsRowText title="Connect a mailbox first">
          Actions run when new mail arrives in Gmail or a team mailbox. You do
          not have one connected yet, so there is nothing to attach an action
          to.
          {showDemoMailboxHint ? (
            <>
              <br />
              <br />
              <span className="text-muted-fg">
                Local demo mail is for previewing the inbox only. Connect a real
                mailbox to create actions.
              </span>
            </>
          ) : null}
        </SettingsRowText>
        <Button onClick={openMailboxesSettings} size="sm" type="button">
          Go to Mailboxes
          <HugeiconsIcon
            aria-hidden
            className="size-4"
            icon={ArrowRight01Icon}
          />
        </Button>
      </div>
    </SettingsCard>
  );
};

export const ActionsSettingsPanel = () => {
  const navigate = useNavigate({ from: "/settings" });
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>();
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const isDemoMode = useDemoModeEnabled();
  const isManagedDemoMode = useManagedDemoModeEnabled();
  const previewPersona = usePreviewPersona();
  const { data: mailboxesData, isLoading: mailboxesLoading } = useQuery(
    mailboxesQueryOptions()
  );
  const { data: connectorsData } = useQuery(connectorsQueryOptions());
  const mailboxOptions = buildMailboxOptions(mailboxesData?.groups ?? []);
  const activeMailboxId = selectedMailboxId ?? mailboxOptions[0]?.id;
  const activeMailbox = mailboxOptions.find(
    (mailbox) => mailbox.id === activeMailboxId
  );
  const { data: actionsData, isLoading: actionsLoading } = useQuery(
    mailboxActionsListQueryOptions(activeMailboxId)
  );
  const actions = actionsData?.actions ?? [];
  const activeActionId = actions.some(
    (action) => action.id === selectedActionId
  )
    ? selectedActionId
    : actions[0]?.id;
  const { data: actionData } = useQuery(
    mailboxActionQueryOptions(activeMailboxId, activeActionId)
  );
  const action = actionData?.action;
  const draftRevision =
    actionData?.revisions.find(
      (revision) => revision.id === action?.draftRevisionId
    ) ?? actionData?.revisions[0];
  const hasActionableMailbox = mailboxOptions.length > 0;
  const showDemoMailboxHint =
    isDemoMode || isManagedDemoMode || previewPersona !== null;

  const openMailboxesSettings = () => {
    void navigate({
      search: (previous) => ({
        ...previous,
        mailboxId: "",
        organizationId: "",
        organizationView: "overview",
        tab: "mailboxes",
      }),
      to: ".",
    });
  };

  return (
    <div className="space-y-8">
      <SettingsPageHeader title="Actions">
        Run one plain-language instruction when new mail arrives in a Gmail or
        managed mailbox.
      </SettingsPageHeader>

      {renderActionsBody({
        action,
        actions,
        actionsLoading,
        activeActionId,
        activeMailbox,
        activeMailboxId,
        connectorsData,
        draftRevision,
        hasActionableMailbox,
        mailboxOptions,
        mailboxesLoading,
        openMailboxesSettings,
        setSelectedActionId,
        setSelectedMailboxId,
        showDemoMailboxHint,
      })}
    </div>
  );
};
