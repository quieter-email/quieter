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
import { Textarea } from "@quieter/ui/textarea";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  CONNECTORS_QUERY_KEY,
  openConnectorLink,
} from "#/lib/connectors-query";
import {
  linearMetadataQueryOptions,
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
type MailboxActionDetail = RouterOutputs["mailboxActions"]["get"]["action"];
type MailboxActionRevision =
  RouterOutputs["mailboxActions"]["get"]["revisions"][number];
type ConnectorsData = RouterOutputs["connectors"]["list"];

const DEFAULT_ACTION_INSTRUCTIONS =
  "When it's a bug or feature request, use @Linear to search for duplicate issues. If none are found, create a clear new issue with the right team, title, description, labels, priority, and useful context from the email.";

const TRIGGER_OPTIONS = [
  { label: "On Email Received", value: "email_received" },
] as const;
const TRIGGER_VALUE = TRIGGER_OPTIONS[0].value;

const isLinearAgentNode = (
  node: unknown
): node is { config?: Record<string, unknown>; type: "linear_agent_issue" } => {
  if (node === null || node === undefined || typeof node !== "object") {
    return false;
  }
  return "type" in node && node.type === "linear_agent_issue";
};

const getLinearAccountLabel = (
  account: NonNullable<ConnectorsData>["connectors"][number]["accounts"][number]
) =>
  account.providerWorkspaceName ??
  account.accountEmail ??
  account.displayName ??
  "Linear";

const getSimpleActionConfig = (graph: unknown) => {
  if (graph === null || graph === undefined || typeof graph !== "object") {
    return {
      credentialId: "",
      instructions: DEFAULT_ACTION_INSTRUCTIONS,
      teamId: "",
    };
  }

  const { nodes } = graph as { nodes?: unknown };
  const linearNode = Array.isArray(nodes)
    ? nodes.find(isLinearAgentNode)
    : undefined;
  const config =
    linearNode !== undefined &&
    "config" in linearNode &&
    linearNode.config !== null &&
    linearNode.config !== undefined &&
    typeof linearNode.config === "object"
      ? linearNode.config
      : {};

  const instructionsValue =
    typeof config.instructions === "string" ? config.instructions.trim() : "";

  return {
    credentialId:
      typeof config.credentialId === "string" ? config.credentialId : "",
    instructions:
      instructionsValue === ""
        ? DEFAULT_ACTION_INSTRUCTIONS
        : instructionsValue,
    teamId: typeof config.teamId === "string" ? config.teamId : "",
  };
};

const createSimpleActionGraph = ({
  credentialId,
  instructions,
  teamId,
}: {
  credentialId: string;
  instructions: string;
  teamId: string;
}): MailboxActionGraph => ({
  edges: [
    {
      id: "edge-trigger-linear",
      source: "trigger",
      sourcePort: "out",
      target: "linear",
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
        teamId: teamId === "" ? undefined : teamId,
      },
      id: "linear",
      position: { x: 320, y: 0 },
      type: "linear_agent_issue",
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

const getLinearCredentialId = (credentialId: string) =>
  credentialId === "" ? undefined : credentialId;

type LinearAccount =
  NonNullable<ConnectorsData>["connectors"][number]["accounts"][number];
type LinearTeam =
  RouterOutputs["mailboxActions"]["linearMetadata"]["teams"][number];

const ActionRuleFields = ({
  credentialId,
  instructions,
  linearAccounts,
  linearConfigured,
  linearMetadataLoading,
  onConnectLinear,
  setCredentialId,
  setInstructions,
  setName,
  setTeamId,
  startingLinear,
  teamId,
  teams,
  name,
}: {
  credentialId: string;
  instructions: string;
  linearAccounts: LinearAccount[];
  linearConfigured: boolean | undefined;
  linearMetadataLoading: boolean;
  name: string;
  onConnectLinear: () => void;
  setCredentialId: (value: string) => void;
  setInstructions: (value: string) => void;
  setName: (value: string) => void;
  setTeamId: (value: string) => void;
  startingLinear: boolean;
  teamId: string;
  teams: LinearTeam[];
}) => (
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
      description="The connector the instruction can use. Type @Linear in the instruction when you want the agent to use Linear."
      label="Connector"
    >
      <div className="space-y-3">
        {linearAccounts.length > 0 ? (
          <Select
            items={linearAccounts.map((account) => ({
              label: getLinearAccountLabel(account),
              value: account.id,
            }))}
            onValueChange={(value) => {
              if (value === null || value === undefined || value === "") {
                return;
              }
              setCredentialId(value);
              setTeamId("");
            }}
            value={credentialId}
          >
            <SelectTrigger aria-label="Linear account">
              <SelectValue placeholder="Select Linear workspace" />
            </SelectTrigger>
            <SelectContent>
              {linearAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {getLinearAccountLabel(account)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Button
            disabled={startingLinear || linearConfigured === false}
            onClick={onConnectLinear}
            size="sm"
            type="button"
            variant="outline"
          >
            {startingLinear ? (
              <HugeiconsIcon
                aria-hidden
                className="size-4 animate-spin"
                icon={Loading03Icon}
              />
            ) : (
              <img
                alt=""
                aria-hidden
                className="size-4 invert dark:invert-0"
                height={16}
                src="/linear.svg"
                width={16}
              />
            )}
            Connect Linear
          </Button>
        )}
        <Select
          disabled={credentialId === "" || linearMetadataLoading}
          items={teams.map((team) => ({
            label: `${team.name} (${team.key})`,
            value: team.id,
          }))}
          onValueChange={(value) => {
            if (value === null || value === undefined || value === "") {
              return;
            }
            setTeamId(value);
          }}
          value={teamId}
        >
          <SelectTrigger aria-label="Linear team">
            <SelectValue placeholder="Select Linear team" />
          </SelectTrigger>
          <SelectContent>
            {teams.map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name} ({team.key})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </SimpleField>

    <SimpleField
      description="Write the whole behavior in one prompt. The email content is provided automatically when the action runs."
      label="Instruction"
    >
      <div className="space-y-2">
        <Textarea
          aria-label="Action instruction"
          className="min-h-36"
          onChange={(event) => {
            setInstructions(event.target.value);
          }}
          placeholder={DEFAULT_ACTION_INSTRUCTIONS}
          value={instructions}
        />
        <p className={settingsSurfaceVariants({ variant: "value" })}>
          Example: When it&apos;s a bug or feature request, use{" "}
          <span className="rounded-full border border-[#5e6ad2]/40 bg-[#5e6ad2]/15 px-1.5 py-0.5 text-[#b8bef8]">
            @Linear
          </span>{" "}
          to search for duplicate issues, then create one if needed.
        </p>
      </div>
    </SimpleField>
  </div>
);

const hasEditorValue = (value: string | null | undefined): value is string =>
  value !== undefined && value !== "";

const getActionErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const getActionFormDirty = ({
  action,
  credentialId,
  initialCredentialId,
  initialInstructions,
  initialTeamId,
  instructions,
  name,
  teamId,
}: {
  action: MailboxActionDetail | undefined;
  credentialId: string;
  initialCredentialId: string;
  initialInstructions: string;
  initialTeamId: string;
  instructions: string;
  name: string;
  teamId: string;
}) =>
  [
    name !== (action?.name ?? "New action"),
    credentialId !== initialCredentialId,
    teamId !== initialTeamId,
    instructions !== initialInstructions,
  ].some(Boolean);

const getActionHasRequiredFields = ({
  credentialId,
  instructions,
  teamId,
}: {
  credentialId: string;
  instructions: string;
  teamId: string;
}) =>
  [credentialId, teamId].every((value) => value !== "") &&
  instructions.trim() !== "";

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
  const [startingLinear, setStartingLinear] = useState(false);
  const [name, setName] = useState(action?.name ?? "New action");
  const [credentialId, setCredentialId] = useState(initialConfig.credentialId);
  const [teamId, setTeamId] = useState(initialConfig.teamId);
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
      initialTeamId: initialConfig.teamId,
      instructions,
      name,
      teamId,
    }),
    name,
    setCredentialId,
    setInstructions,
    setName,
    setStartingLinear,
    setTeamId,
    startingLinear,
    teamId,
  };
};

const useActionEditorLinearData = (
  connectorsData: ConnectorsData | undefined,
  credentialId: string
) => {
  const linearConnector = connectorsData?.connectors.find(
    (connector) => connector.provider === "linear"
  );
  const linearAccounts =
    linearConnector?.accounts.filter(
      (account) => account.status === "connected"
    ) ?? [];
  const { data: linearMetadata, isLoading: linearMetadataLoading } = useQuery(
    linearMetadataQueryOptions(getLinearCredentialId(credentialId))
  );

  return {
    linearAccounts,
    linearConfigured: linearConnector?.isConfigured,
    linearMetadataLoading,
    teams: linearMetadata?.teams ?? [],
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
        queryKey: mailboxActionQueryKey(activeActionId),
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
  const setEnabledMutation = useMutation({
    ...orpc.mailboxActions.setEnabled.mutationOptions(),
    onError: (error) => {
      toast.error(getActionErrorMessage(error, "Could not update action."));
    },
    onSuccess: invalidateActionQueries,
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
  const linear = useActionEditorLinearData(connectorsData, form.credentialId);
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
        teamId: form.teamId,
      }),
      name: form.name,
    });
  };

  const startLinearConnection = async () => {
    form.setStartingLinear(true);
    try {
      await openConnectorLink({
        provider: "linear",
        returnTo: "/settings?tab=actions",
      });
    } catch (error) {
      form.setStartingLinear(false);
      toast.error(
        getActionErrorMessage(error, "Could not start Linear setup.")
      );
    }
  };

  const hasPublished = hasEditorValue(action?.publishedRevisionId);
  const hasRequiredFields = getActionHasRequiredFields({
    credentialId: form.credentialId,
    instructions: form.instructions,
    teamId: form.teamId,
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
    ...linear,
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
    isSettingEnabled: mutations.setEnabledMutation.isPending,
    publishAction,
    publishDisabled,
    saveDraft,
    selectMailbox,
    setActionEnabled,
    setDeleteOpen,
    startLinearConnection,
    statusDescription,
    validationErrors,
  };
};

const ActionEditorStatus = ({
  action,
  hasPublished,
  isPublishing,
  isSaving,
  isSettingEnabled,
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
  isSettingEnabled: boolean;
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
            disabled={!hasPublished || isSettingEnabled}
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
  isSettingEnabled,
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
  isSettingEnabled: boolean;
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
        <ul className="mt-2 space-y-1 text-sm text-destructive">
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
      isSettingEnabled={isSettingEnabled}
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
                  <p className="text-sm text-muted-fg">
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
    isSettingEnabled,
    linearAccounts,
    linearConfigured,
    linearMetadataLoading,
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
    setTeamId,
    startLinearConnection,
    startingLinear,
    statusDescription,
    teamId,
    teams,
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
            credentialId={credentialId}
            instructions={instructions}
            linearAccounts={linearAccounts}
            linearConfigured={linearConfigured}
            linearMetadataLoading={linearMetadataLoading}
            name={name}
            onConnectLinear={() => {
              void startLinearConnection();
            }}
            setCredentialId={setCredentialId}
            setInstructions={setInstructions}
            setName={setName}
            setTeamId={setTeamId}
            startingLinear={startingLinear}
            teamId={teamId}
            teams={teams}
          />
        }
        hasPublished={hasPublished}
        isPublishing={isPublishing}
        isSaving={isSaving}
        isSettingEnabled={isSettingEnabled}
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
