"use client";

import {
  Add01Icon,
  Delete02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RouterOutputs } from "@quieter/orpc";
import { MAILBOX_ACTION_GRAPH_VERSION } from "@quieter/orpc/mailbox-actions/graph";
import type { MailboxActionGraph } from "@quieter/orpc/mailbox-actions/graph";
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
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { TokenField } from "@quieter/ui/token-field";
import type { TokenFieldToken } from "@quieter/ui/token-field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { getConnectorTokens } from "#/features/ai/domain/connector-tokens";
import {
  CONNECTORS_QUERY_KEY,
  openConnectorLink,
} from "#/lib/connectors-query";
import {
  mailboxActionQueryKey,
  mailboxActionsListQueryKey,
} from "#/lib/mailbox-actions-query";
import { orpc } from "#/lib/orpc";

import {
  SettingsCard,
  SettingsRow,
  SettingsRowText,
  SettingsRows,
  SettingsSection,
  settingsSurfaceVariants,
} from "./settings-layout";

export type MailboxOption = {
  emailAddress: string;
  groupName: string;
  id: string;
  label: string;
  provider: string;
};

type MailboxActionListItem =
  RouterOutputs["mailboxActions"]["list"]["actions"][number];
type MailboxActionQueryData = RouterOutputs["mailboxActions"]["get"];
type MailboxActionDetail = RouterOutputs["mailboxActions"]["get"]["action"];
type MailboxActionRevision =
  RouterOutputs["mailboxActions"]["get"]["revisions"][number];
type ConnectorsData = RouterOutputs["connectors"]["list"];

const DEFAULT_ACTION_INSTRUCTIONS =
  "When it's a bug or feature request, mention the app that should handle it, search there for anything matching, and otherwise create a clear new entry with a title, description, and useful context from the email.";

const TRIGGER_OPTIONS = [
  { label: "On Email Received", value: "email_received" },
] as const;
const TRIGGER_VALUE = TRIGGER_OPTIONS[0].value;

type ConnectorProvider =
  NonNullable<ConnectorsData>["connectors"][number]["provider"];

const isConnectorAgentNode = (
  node: unknown
): node is { config?: Record<string, unknown>; type: "connector_agent" } => {
  if (node === null || node === undefined || typeof node !== "object") {
    return false;
  }
  return "type" in node && node.type === "connector_agent";
};

const getConnectorAccountLabel = (
  account: NonNullable<ConnectorsData>["connectors"][number]["accounts"][number],
  fallback: string
) =>
  account.providerWorkspaceName ??
  account.accountEmail ??
  account.displayName ??
  fallback;

const getSimpleActionConfig = (
  graph: unknown
): { credentialId: string; instructions: string; provider: string } => {
  const empty = { credentialId: "", instructions: "", provider: "" } as const;

  if (graph === null || graph === undefined || typeof graph !== "object") {
    return empty;
  }

  const { nodes } = graph as { nodes?: unknown };
  const connectorNode = Array.isArray(nodes)
    ? nodes.find(isConnectorAgentNode)
    : undefined;
  const config =
    connectorNode !== undefined &&
    "config" in connectorNode &&
    connectorNode.config !== null &&
    connectorNode.config !== undefined &&
    typeof connectorNode.config === "object"
      ? connectorNode.config
      : {};

  return {
    credentialId:
      typeof config.credentialId === "string" ? config.credentialId : "",
    instructions:
      typeof config.instructions === "string" ? config.instructions : "",
    provider: typeof config.provider === "string" ? config.provider : "",
  };
};

const createSimpleActionGraph = ({
  credentialId,
  instructions,
  provider,
}: {
  credentialId: string;
  instructions: string;
  provider: ConnectorProvider | undefined;
}): MailboxActionGraph => ({
  edges: [
    {
      id: "edge-trigger-connector",
      source: "trigger",
      sourcePort: "out",
      target: "connector",
      targetPort: "in",
    },
  ],
  nodes: [
    {
      config: {},
      id: "trigger",
      position: { x: 0, y: 0 },
      type: "email_received",
    },
    {
      config: {
        credentialId: credentialId === "" ? undefined : credentialId,
        instructions,
        provider,
      },
      id: "connector",
      position: { x: 320, y: 0 },
      type: "connector_agent",
    },
  ],
  version: MAILBOX_ACTION_GRAPH_VERSION,
});

const SimpleField = ({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description?: string;
  label: string;
}) => (
  <div className="grid gap-3 p-4 md:grid-cols-[12rem_minmax(0,1fr)] md:px-6">
    <div>
      <p className={settingsSurfaceVariants({ variant: "title" })}>{label}</p>
      {description === undefined || description === "" ? null : (
        <p
          className={cn("mt-1", settingsSurfaceVariants({ variant: "value" }))}
        >
          {description}
        </p>
      )}
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);

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

type ConnectorAccount =
  NonNullable<ConnectorsData>["connectors"][number]["accounts"][number];
type ConnectorSummary = NonNullable<ConnectorsData>["connectors"][number];

const ConnectorAccountField = ({
  accounts,
  connector,
  credentialId,
  onConnect,
  setCredentialId,
  startingConnection,
}: {
  accounts: ConnectorAccount[];
  connector: ConnectorSummary;
  credentialId: string;
  onConnect: (provider: ConnectorProvider) => void;
  setCredentialId: (value: string) => void;
  startingConnection: boolean;
}) => {
  if (accounts.length === 0) {
    return (
      <Button
        disabled={startingConnection || !connector.isConfigured}
        onClick={() => {
          onConnect(connector.provider);
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {startingConnection ? (
          <HugeiconsIcon
            aria-hidden
            className="size-4 animate-spin"
            icon={Loading03Icon}
          />
        ) : null}
        Connect {connector.displayName}
      </Button>
    );
  }

  return (
    <Select
      items={accounts.map((account) => ({
        label: getConnectorAccountLabel(account, connector.displayName),
        value: account.id,
      }))}
      onValueChange={(value) => {
        if (value === null || value === undefined || value === "") {
          return;
        }
        setCredentialId(value);
      }}
      value={credentialId}
    >
      <SelectTrigger aria-label={`${connector.displayName} account`}>
        <SelectValue placeholder={`Select ${connector.displayName} account`} />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            {getConnectorAccountLabel(account, connector.displayName)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const ActionRuleFields = ({
  connectorTokens,
  connectors,
  credentialId,
  instructions,
  name,
  onConnect,
  provider,
  setCredentialId,
  setInstructions,
  setName,
  setProvider,
  startingConnection,
}: {
  connectorTokens: TokenFieldToken[];
  connectors: ConnectorSummary[];
  credentialId: string;
  instructions: string;
  name: string;
  onConnect: (provider: ConnectorProvider) => void;
  provider: string;
  setCredentialId: (value: string) => void;
  setInstructions: (value: string) => void;
  setName: (value: string) => void;
  setProvider: (value: string) => void;
  startingConnection: boolean;
}) => {
  const selected = connectors.find((item) => item.provider === provider);
  const accounts: ConnectorAccount[] =
    selected?.accounts.filter((account) => account.status === "connected") ??
    [];

  return (
    <div className="divide-y divide-border/70">
      <SimpleField label="Name">
        <Input
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="Action name"
          value={name}
        />
      </SimpleField>

      <SimpleField
        description="The first event that starts this action."
        label="Trigger"
      >
        <Select
          items={TRIGGER_OPTIONS.map((option) => ({
            label: option.label,
            value: option.value,
          }))}
          value={TRIGGER_VALUE}
        >
          <SelectTrigger aria-label="Trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="email_received">On Email Received</SelectItem>
          </SelectContent>
        </Select>
      </SimpleField>

      <SimpleField
        description="The app this action works in. It figures out where to put things from your instruction and what the connection can reach."
        label="App"
      >
        <div className="space-y-3">
          <Select
            items={connectors.map((connector) => ({
              label: connector.displayName,
              value: connector.provider,
            }))}
            onValueChange={(value) => {
              if (value === null || value === undefined || value === "") {
                return;
              }
              setProvider(value);
              setCredentialId("");
            }}
            value={provider}
          >
            <SelectTrigger aria-label="App">
              <SelectValue placeholder="Select an app" />
            </SelectTrigger>
            <SelectContent>
              {connectors.map((connector) => (
                <SelectItem key={connector.provider} value={connector.provider}>
                  {connector.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selected === undefined ? null : (
            <ConnectorAccountField
              accounts={accounts}
              connector={selected}
              credentialId={credentialId}
              onConnect={onConnect}
              setCredentialId={setCredentialId}
              startingConnection={startingConnection}
            />
          )}
        </div>
      </SimpleField>

      <SimpleField
        description="Write the whole behavior in one prompt. The email content is provided automatically when the action runs."
        label="Instruction"
      >
        <div className="space-y-2">
          <div className="squircle rounded-md border border-border bg-input px-3 py-2 shadow-sm transition-colors duration-150 ease-out focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/45">
            <TokenField
              aria-label="Action instruction"
              className="max-h-72 min-h-32 overflow-y-auto text-body"
              onChange={setInstructions}
              placeholder={DEFAULT_ACTION_INSTRUCTIONS}
              suggestionsLabel="Connectors"
              tokens={connectorTokens}
              value={instructions}
            />
          </div>
          <p className={settingsSurfaceVariants({ variant: "value" })}>
            Type @ to mention a connected app, and the agent uses it for that
            step.
          </p>
        </div>
      </SimpleField>
    </div>
  );
};

const hasEditorValue = (value: string | null | undefined): value is string =>
  value !== undefined && value !== "";

const getActionErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const getActionFormDirty = ({
  action,
  credentialId,
  initialCredentialId,
  initialInstructions,
  initialProvider,
  instructions,
  name,
  provider,
}: {
  action: MailboxActionDetail | undefined;
  credentialId: string;
  initialCredentialId: string;
  initialInstructions: string;
  initialProvider: string;
  instructions: string;
  name: string;
  provider: string;
}) =>
  [
    name !== (action?.name ?? "New action"),
    credentialId !== initialCredentialId,
    provider !== initialProvider,
    instructions !== initialInstructions,
  ].some(Boolean);

const getActionHasRequiredFields = ({
  credentialId,
  instructions,
  provider,
}: {
  credentialId: string;
  instructions: string;
  provider: string;
}) => credentialId !== "" && provider !== "" && instructions.trim() !== "";

const getActionPublishDisabled = ({
  action,
  hasRequiredFields,
  isDirty,
  isPublishing,
  isSaving,
  validationErrorCount,
}: {
  action: MailboxActionDetail | undefined;
  hasRequiredFields: boolean;
  isDirty: boolean;
  isPublishing: boolean;
  isSaving: boolean;
  validationErrorCount: number;
}) =>
  [
    action === undefined,
    isDirty,
    !hasRequiredFields,
    isPublishing,
    validationErrorCount > 0,
    isSaving,
  ].some(Boolean);

const getActionStatusDescription = ({
  hasPublished,
  isDirty,
}: {
  hasPublished: boolean;
  isDirty: boolean;
}) => {
  if (!hasPublished) {
    return "Save and publish before enabling this action.";
  }
  if (isDirty) {
    return "Save changes before publishing or enabling the latest version.";
  }
  return "Published actions can be enabled or disabled.";
};

const notifySavedAction = (validationStatus: string) => {
  if (validationStatus === "valid") {
    toast.success("Action saved.");
    return;
  }
  toast.warning("Action saved with missing fields.");
};

const useActionEditorForm = (
  action: MailboxActionDetail | undefined,
  draftRevision: MailboxActionRevision | undefined
) => {
  const initialConfig = getSimpleActionConfig(draftRevision?.graph);
  const [startingConnection, setStartingConnection] = useState(false);
  const [name, setName] = useState(action?.name ?? "New action");
  const [credentialId, setCredentialId] = useState(initialConfig.credentialId);
  const [provider, setProvider] = useState(initialConfig.provider);
  const [instructions, setInstructions] = useState(initialConfig.instructions);

  return {
    credentialId,
    initialConfig,
    instructions,
    isDirty: getActionFormDirty({
      action,
      credentialId,
      initialCredentialId: initialConfig.credentialId,
      initialInstructions: initialConfig.instructions,
      initialProvider: initialConfig.provider,
      instructions,
      name,
      provider,
    }),
    name,
    provider,
    setCredentialId,
    setInstructions,
    setName,
    setProvider,
    setStartingConnection,
    startingConnection,
  };
};

const useActionEditorMutations = ({
  activeActionId,
  activeMailboxId,
  setSelectedActionId,
}: {
  activeActionId: string | undefined;
  activeMailboxId: string | undefined;
  setSelectedActionId: (actionId: string | undefined) => void;
}) => {
  const queryClient = useQueryClient();
  const invalidateActionQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: mailboxActionsListQueryKey(activeMailboxId),
      }),
      queryClient.invalidateQueries({
        queryKey: mailboxActionQueryKey(activeMailboxId, activeActionId),
      }),
      queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_KEY }),
    ]);
  };

  const createActionMutation = useMutation({
    ...orpc.mailboxActions.create.mutationOptions(),
    onSuccess: async (result) => {
      setSelectedActionId(result.actionId);
      await queryClient.invalidateQueries({
        queryKey: mailboxActionsListQueryKey(activeMailboxId),
      });
    },
  });
  const saveDraftMutation = useMutation({
    ...orpc.mailboxActions.saveDraft.mutationOptions(),
    onError: (error) => {
      toast.error(getActionErrorMessage(error, "Could not save action."));
    },
    onSuccess: async (result) => {
      await invalidateActionQueries();
      notifySavedAction(result.validationStatus);
    },
  });
  const publishMutation = useMutation({
    ...orpc.mailboxActions.publish.mutationOptions(),
    onError: (error) => {
      toast.error(getActionErrorMessage(error, "Could not publish action."));
    },
    onSuccess: async () => {
      await invalidateActionQueries();
      toast.success("Action published.");
    },
  });
  // Enabling an action is reversible, so the switch moves at once and rolls
  // back if the write fails.
  const optimisticSetEnabled = {
    onError: (
      error: unknown,
      input: { actionId: string; enabled: boolean },
      context: { previous: MailboxActionQueryData | undefined } | undefined
    ) => {
      queryClient.setQueryData(
        mailboxActionQueryKey(activeMailboxId, input.actionId),
        context?.previous
      );
      toast.error(getActionErrorMessage(error, "Could not update action."));
    },
    onMutate: async (input: { actionId: string; enabled: boolean }) => {
      const actionKey = mailboxActionQueryKey(activeMailboxId, input.actionId);
      await queryClient.cancelQueries({ queryKey: actionKey });
      const previous =
        queryClient.getQueryData<MailboxActionQueryData>(actionKey);
      queryClient.setQueryData<MailboxActionQueryData>(actionKey, (current) =>
        current === undefined
          ? current
          : {
              ...current,
              action: { ...current.action, enabled: input.enabled },
            }
      );
      return { previous };
    },
  };
  const setEnabledMutation = useMutation({
    ...orpc.mailboxActions.setEnabled.mutationOptions(),
    ...optimisticSetEnabled,
    onSettled: invalidateActionQueries,
  });
  const deleteActionMutation = useMutation({
    ...orpc.mailboxActions.delete.mutationOptions(),
    onError: (error) => {
      toast.error(getActionErrorMessage(error, "Could not delete action."));
    },
    onSuccess: async () => {
      setSelectedActionId(undefined);
      await queryClient.invalidateQueries({
        queryKey: mailboxActionsListQueryKey(activeMailboxId),
      });
      toast.success("Action deleted.");
    },
  });

  return {
    createActionMutation,
    deleteActionMutation,
    invalidateActionQueries,
    publishMutation,
    saveDraftMutation,
    setEnabledMutation,
  };
};

const useActionEditorController = ({
  action,
  activeActionId,
  activeMailboxId,
  connectorsData,
  draftRevision,
  setSelectedActionId,
  setSelectedMailboxId,
}: {
  action: MailboxActionDetail | undefined;
  activeActionId: string | undefined;
  activeMailboxId: string | undefined;
  connectorsData: ConnectorsData | undefined;
  draftRevision: MailboxActionRevision | undefined;
  setSelectedActionId: (actionId: string | undefined) => void;
  setSelectedMailboxId: (mailboxId: string | undefined) => void;
}) => {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const form = useActionEditorForm(action, draftRevision);
  const connectors = connectorsData?.connectors ?? [];
  const mutations = useActionEditorMutations({
    activeActionId,
    activeMailboxId,
    setSelectedActionId,
  });
  const validationErrors = draftRevision?.validationErrors ?? [];

  const createAction = () => {
    if (!hasEditorValue(activeMailboxId)) {
      return;
    }
    mutations.createActionMutation.mutate({
      mailboxId: activeMailboxId,
      name: "New action",
    });
  };

  const saveDraft = () => {
    if (!hasEditorValue(activeActionId)) {
      return;
    }
    mutations.saveDraftMutation.mutate({
      actionId: activeActionId,
      graph: createSimpleActionGraph({
        credentialId: form.credentialId,
        instructions: form.instructions,
        // Resolving through the connector list keeps a stale stored provider
        // from being saved back as if it were still valid.
        provider: connectors.find(
          (connector) => connector.provider === form.provider
        )?.provider,
      }),
      name: form.name,
    });
  };

  const startConnection = async (provider: ConnectorProvider) => {
    form.setStartingConnection(true);
    try {
      await openConnectorLink({
        provider,
        returnTo: "/settings?tab=actions",
      });
    } catch (error) {
      form.setStartingConnection(false);
      toast.error(getActionErrorMessage(error, "Could not start setup."));
    }
  };

  const hasPublished = hasEditorValue(action?.publishedRevisionId);
  const hasRequiredFields = getActionHasRequiredFields({
    credentialId: form.credentialId,
    instructions: form.instructions,
    provider: form.provider,
  });
  const publishDisabled = getActionPublishDisabled({
    action,
    hasRequiredFields,
    isDirty: form.isDirty,
    isPublishing: mutations.publishMutation.isPending,
    isSaving: mutations.saveDraftMutation.isPending,
    validationErrorCount: validationErrors.length,
  });
  const statusDescription = getActionStatusDescription({
    hasPublished,
    isDirty: form.isDirty,
  });

  const selectMailbox = (mailboxId: string) => {
    setSelectedMailboxId(mailboxId);
    setSelectedActionId(undefined);
  };
  const publishAction = () => {
    if (!hasEditorValue(activeActionId)) {
      return;
    }
    mutations.publishMutation.mutate({ actionId: activeActionId });
  };
  const setActionEnabled = (enabled: boolean) => {
    if (!hasEditorValue(activeActionId)) {
      return;
    }
    mutations.setEnabledMutation.mutate({
      actionId: activeActionId,
      enabled,
    });
  };
  const deleteAction = () => {
    if (hasEditorValue(activeActionId)) {
      mutations.deleteActionMutation.mutate({ actionId: activeActionId });
    }
    setDeleteOpen(false);
  };

  return {
    ...form,
    connectors,
    ...mutations,
    createAction,
    createDisabled:
      !hasEditorValue(activeMailboxId) ||
      mutations.createActionMutation.isPending,
    deleteAction,
    deleteDisabled: !hasEditorValue(activeActionId),
    deleteOpen,
    hasPublished,
    hasRequiredFields,
    isCreating: mutations.createActionMutation.isPending,
    isDeleting: mutations.deleteActionMutation.isPending,
    isPublishing: mutations.publishMutation.isPending,
    isSaving: mutations.saveDraftMutation.isPending,
    publishAction,
    publishDisabled,
    saveDraft,
    selectMailbox,
    setActionEnabled,
    setDeleteOpen,
    startConnection,
    statusDescription,
    validationErrors,
  };
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

const ActionEditorRuleSection = ({
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

const ActionEditorEmptyState = ({
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

const ActionEditorMailboxSection = ({
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

const ActionEditorSavedActionsSection = ({
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
