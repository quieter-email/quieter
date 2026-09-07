"use client";

import { useMemo } from "react";

import { getConnectorTokens } from "#/features/ai/domain/connector-tokens";

import {
  ActionEditorRuleSection,
  ActionEditorEmptyState,
  ActionEditorMailboxSection,
  ActionEditorSavedActionsSection,
} from "./action-editor-sections";
import type {
  MailboxActionListItem,
  MailboxActionDetail,
  MailboxActionRevision,
  ConnectorsData,
} from "./action-editor-types";
import { ActionRuleFields } from "./action-rule-fields";
import { useActionEditorController } from "./use-action-editor";

export type MailboxOption = {
  emailAddress: string;
  groupName: string;
  id: string;
  label: string;
  provider: string;
};

export const ActionSimpleEditor = ({
  action,
  actions,
  actionsLoading,
  activeActionId,
  activeMailbox,
  activeMailboxId,
  connectorsData,
  draftRevision,
  mailboxesLoading,
  mailboxOptions,
  setSelectedActionId,
  setSelectedMailboxId,
}: {
  action: MailboxActionDetail | undefined;
  actions: MailboxActionListItem[];
  actionsLoading: boolean;
  activeActionId: string | undefined;
  activeMailbox: MailboxOption | undefined;
  activeMailboxId: string | undefined;
  connectorsData: ConnectorsData | undefined;
  draftRevision: MailboxActionRevision | undefined;
  mailboxesLoading: boolean;
  mailboxOptions: MailboxOption[];
  setSelectedActionId: (actionId: string | undefined) => void;
  setSelectedMailboxId: (mailboxId: string | undefined) => void;
}) => {
  const {
    credentialId,
    createAction,
    createDisabled,
    deleteAction,
    deleteDisabled,
    deleteOpen,
    hasPublished,
    instructions,
    isCreating,
    isDeleting,
    isPublishing,
    isSaving,
    connectors,
    name,
    publishAction,
    publishDisabled,
    saveDraft,
    selectMailbox,
    setActionEnabled,
    setCredentialId,
    setDeleteOpen,
    setInstructions,
    setName,
    setProvider,
    startConnection,
    startingConnection,
    statusDescription,
    provider,
    validationErrors,
  } = useActionEditorController({
    action,
    activeActionId,
    activeMailboxId,
    connectorsData,
    draftRevision,
    setSelectedActionId,
    setSelectedMailboxId,
  });
  const connectorTokens = useMemo(
    () => getConnectorTokens(connectorsData),
    [connectorsData]
  );

  const ruleSection =
    action === undefined ? (
      <ActionEditorEmptyState
        createDisabled={createDisabled}
        isCreating={isCreating}
        onCreate={createAction}
      />
    ) : (
      <ActionEditorRuleSection
        action={action}
        fields={
          <ActionRuleFields
            connectorTokens={connectorTokens}
            connectors={connectors}
            credentialId={credentialId}
            instructions={instructions}
            name={name}
            onConnect={(nextProvider) => {
              void startConnection(nextProvider);
            }}
            provider={provider}
            setCredentialId={setCredentialId}
            setInstructions={setInstructions}
            setName={setName}
            setProvider={setProvider}
            startingConnection={startingConnection}
          />
        }
        hasPublished={hasPublished}
        isPublishing={isPublishing}
        isSaving={isSaving}
        onPublish={publishAction}
        onSave={saveDraft}
        onSetEnabled={setActionEnabled}
        publishDisabled={publishDisabled}
        statusDescription={statusDescription}
        validationErrors={validationErrors}
      />
    );

  return (
    <div className="space-y-8">
      <ActionEditorMailboxSection
        activeMailbox={activeMailbox}
        activeMailboxId={activeMailboxId}
        mailboxesLoading={mailboxesLoading}
        mailboxOptions={mailboxOptions}
        onSelectMailbox={selectMailbox}
      />

      <ActionEditorSavedActionsSection
        action={action}
        actions={actions}
        actionsLoading={actionsLoading}
        activeActionId={activeActionId}
        createDisabled={createDisabled}
        createActionPending={isCreating}
        deleteDisabled={deleteDisabled}
        deleteOpen={deleteOpen}
        deletePending={isDeleting}
        onCreateAction={createAction}
        onDeleteAction={deleteAction}
        onOpenDelete={() => {
          setDeleteOpen(true);
        }}
        onSelectAction={setSelectedActionId}
        setDeleteOpen={setDeleteOpen}
      />

      {ruleSection}
    </div>
  );
};
