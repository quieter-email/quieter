"use client";

import type { RouterOutputs } from "@quieter/orpc";
import type { ReactNode } from "react";
import {
  Add01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  MAILBOX_ACTION_GRAPH_VERSION,
  type MailboxActionGraph,
} from "@quieter/orpc/mailbox-actions/graph";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@quieter/ui/select";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useDemoModeEnabled } from "~/features/settings/domain/demo-mode-setting";
import { useManagedDemoModeEnabled } from "~/features/settings/domain/managed-demo-mode-setting";
import {
  CONNECTORS_QUERY_KEY,
  connectorsQueryOptions,
  openConnectorLink,
} from "~/lib/connectors-query";
import {
  linearMetadataQueryOptions,
  mailboxActionQueryKey,
  mailboxActionQueryOptions,
  mailboxActionsListQueryKey,
  mailboxActionsListQueryOptions,
} from "~/lib/mailbox-actions-query";
import { mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";
import { usePreviewPersona } from "~/lib/preview-personas";
import {
  SettingsCard,
  SettingsPageHeader,
  SettingsRow,
  SettingsRowText,
  SettingsRows,
  SettingsSection,
  settingsRowTitleClass,
  settingsRowValueClass,
} from "./settings-layout";

type MailboxOption = {
  emailAddress: string;
  groupName: string;
  id: string;
  label: string;
  provider: string;
};

type MailboxActionListItem = RouterOutputs["mailboxActions"]["list"]["actions"][number];
type MailboxActionDetail = RouterOutputs["mailboxActions"]["get"]["action"];
type MailboxActionRevision = RouterOutputs["mailboxActions"]["get"]["revisions"][number];
type ConnectorsData = RouterOutputs["connectors"]["list"];

const DEFAULT_ACTION_INSTRUCTIONS =
  "When it's a bug or feature request, use @Linear to search for duplicate issues. If none are found, create a clear new issue with the right team, title, description, labels, priority, and useful context from the email.";

const TRIGGER_OPTIONS = [{ label: "On Email Received", value: "email_received" }] as const;

export const ActionsSettingsPanel = () => {
  const navigate = useNavigate({ from: "/settings" });
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>();
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const isDemoMode = useDemoModeEnabled();
  const isManagedDemoMode = useManagedDemoModeEnabled();
  const previewPersona = usePreviewPersona();
  const { data: mailboxesData, isLoading: mailboxesLoading } = useQuery(mailboxesQueryOptions());
  const { data: connectorsData } = useQuery(connectorsQueryOptions());
  const mailboxOptions: MailboxOption[] = [];
  for (const group of mailboxesData?.groups ?? []) {
    for (const mailbox of group.mailboxes) {
      if (mailbox.provider !== "gmail" && mailbox.provider !== "managed") continue;
      mailboxOptions.push({
        emailAddress: mailbox.emailAddress,
        groupName: group.name,
        id: mailbox.id,
        label: mailbox.displayName || mailbox.emailAddress,
        provider: mailbox.provider,
      });
    }
  }
  const activeMailboxId = selectedMailboxId ?? mailboxOptions[0]?.id;
  const activeMailbox = mailboxOptions.find((mailbox) => mailbox.id === activeMailboxId);
  const { data: actionsData, isLoading: actionsLoading } = useQuery(
    mailboxActionsListQueryOptions(activeMailboxId),
  );
  const actions = actionsData?.actions ?? [];
  const activeActionId = actions.some((action) => action.id === selectedActionId)
    ? selectedActionId
    : actions[0]?.id;
  const { data: actionData } = useQuery(mailboxActionQueryOptions(activeActionId));
  const action = actionData?.action;
  const draftRevision =
    actionData?.revisions.find((revision) => revision.id === action?.draftRevisionId) ??
    actionData?.revisions[0];
  const hasActionableMailbox = mailboxOptions.length > 0;
  const showDemoMailboxHint = isDemoMode || isManagedDemoMode || previewPersona !== null;

  const openMailboxesSettings = () => {
    void navigate({
      replace: true,
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
        Run one plain-language instruction when new mail arrives in a Gmail or managed mailbox.
      </SettingsPageHeader>

      {mailboxesLoading ? (
        <SettingsCard className="p-6">
          <SettingsRowText title="Loading mailboxes">
            Checking which mailboxes you can use for actions.
          </SettingsRowText>
        </SettingsCard>
      ) : !hasActionableMailbox ? (
        <SettingsCard className="p-6">
          <div className="space-y-4">
            <SettingsRowText title="Connect a mailbox first">
              Actions run when new mail arrives in Gmail or a team mailbox. You do not have one
              connected yet, so there is nothing to attach an action to.
              {showDemoMailboxHint && (
                <>
                  <br />
                  <br />
                  <span className="text-muted-foreground">
                    Local demo mail is for previewing the inbox only. Connect a real mailbox to
                    create actions.
                  </span>
                </>
              )}
            </SettingsRowText>
            <Button onClick={openMailboxesSettings} size="sm" type="button">
              Go to Mailboxes
              <HugeiconsIcon aria-hidden className="size-4" icon={ArrowRight01Icon} />
            </Button>
          </div>
        </SettingsCard>
      ) : (
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
      )}
    </div>
  );
};

const ActionSimpleEditor = ({
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
  const queryClient = useQueryClient();
  const initialConfig = getSimpleActionConfig(draftRevision?.graph);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [startingLinear, setStartingLinear] = useState(false);
  const [name, setName] = useState(action?.name ?? "New action");
  const [trigger] = useState<(typeof TRIGGER_OPTIONS)[number]["value"]>("email_received");
  const [credentialId, setCredentialId] = useState(initialConfig.credentialId);
  const [teamId, setTeamId] = useState(initialConfig.teamId);
  const [instructions, setInstructions] = useState(initialConfig.instructions);
  const isDirty =
    name !== (action?.name ?? "New action") ||
    credentialId !== initialConfig.credentialId ||
    teamId !== initialConfig.teamId ||
    instructions !== initialConfig.instructions;
  const linearConnector = connectorsData?.connectors.find(
    (connector) => connector.provider === "linear",
  );
  const linearAccounts =
    linearConnector?.accounts.filter((account) => account.status === "connected") ?? [];
  const { data: linearMetadata, isLoading: linearMetadataLoading } = useQuery(
    linearMetadataQueryOptions(credentialId || undefined),
  );
  const teams = linearMetadata?.teams ?? [];
  const validationErrors = draftRevision?.validationErrors ?? [];

  const invalidateActionQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: mailboxActionsListQueryKey(activeMailboxId) }),
      queryClient.invalidateQueries({ queryKey: mailboxActionQueryKey(activeActionId) }),
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
    onSuccess: async (result) => {
      await invalidateActionQueries();
      if (result.validationStatus === "valid") {
        toast.success("Action saved.");
      } else {
        toast.warning("Action saved with missing fields.");
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save action.");
    },
  });
  const publishMutation = useMutation({
    ...orpc.mailboxActions.publish.mutationOptions(),
    onSuccess: async () => {
      await invalidateActionQueries();
      toast.success("Action published.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not publish action.");
    },
  });
  const setEnabledMutation = useMutation({
    ...orpc.mailboxActions.setEnabled.mutationOptions(),
    onSuccess: invalidateActionQueries,
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not update action.");
    },
  });
  const deleteActionMutation = useMutation({
    ...orpc.mailboxActions.delete.mutationOptions(),
    onSuccess: async () => {
      setSelectedActionId(undefined);
      await queryClient.invalidateQueries({
        queryKey: mailboxActionsListQueryKey(activeMailboxId),
      });
      toast.success("Action deleted.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not delete action.");
    },
  });

  const createAction = () => {
    if (!activeMailboxId) return;
    createActionMutation.mutate({ mailboxId: activeMailboxId, name: "New action" });
  };

  const saveDraft = () => {
    if (!activeActionId) return;
    saveDraftMutation.mutate({
      actionId: activeActionId,
      graph: createSimpleActionGraph({ credentialId, instructions, teamId }),
      name,
    });
  };

  const startLinearConnection = async () => {
    setStartingLinear(true);
    try {
      await openConnectorLink({ provider: "linear", returnTo: "/settings?tab=actions" });
    } catch (error) {
      setStartingLinear(false);
      toast.error(error instanceof Error ? error.message : "Could not start Linear setup.");
    }
  };

  const hasPublished = !!action?.publishedRevisionId;
  const hasRequiredFields = !!credentialId && !!teamId && !!instructions.trim();
  const publishDisabled =
    !action ||
    isDirty ||
    !hasRequiredFields ||
    publishMutation.isPending ||
    validationErrors.length > 0 ||
    saveDraftMutation.isPending;

  return (
    <div className="space-y-8">
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
                  if (!value) return;
                  setSelectedMailboxId(value);
                  setSelectedActionId(undefined);
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

      <SettingsSection
        description="Each action is one plain-language instruction that runs after the selected trigger."
        title="Action"
      >
        <SettingsRows>
          <SettingsRow
            action={
              <div className="flex items-center gap-2">
                <Button
                  disabled={!activeMailboxId || createActionMutation.isPending}
                  onClick={createAction}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {createActionMutation.isPending ? (
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
                <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
                  <IconButtonTooltip label="Delete action">
                    <Button
                      aria-label="Delete action"
                      disabled={!activeActionId || deleteActionMutation.isPending}
                      onClick={() => setDeleteOpen(true)}
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
                        This removes the action and its saved versions for this mailbox.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogBody>
                      <p className="text-sm text-muted-foreground">This cannot be undone.</p>
                    </AlertDialogBody>
                    <AlertDialogFooter>
                      <AlertDialogCloseButton disabled={deleteActionMutation.isPending}>
                        Cancel
                      </AlertDialogCloseButton>
                      <Button
                        disabled={deleteActionMutation.isPending}
                        onClick={() => {
                          if (activeActionId) {
                            deleteActionMutation.mutate({ actionId: activeActionId });
                          }
                          setDeleteOpen(false);
                        }}
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
            {actions.length > 0
              ? "Choose an action to edit, or create another one."
              : actionsLoading
                ? "Loading saved actions."
                : "No actions yet."}
          </SettingsRow>
          {actions.length > 0 ? (
            <SettingsRow
              action={
                <Select
                  items={actions.map((item) => ({ label: item.name, value: item.id }))}
                  onValueChange={(value) => value && setSelectedActionId(value)}
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
              {action?.enabled ? "Published and enabled." : "Draft or disabled."}
            </SettingsRow>
          ) : null}
        </SettingsRows>
      </SettingsSection>

      {action ? (
        <SettingsSection title="Rule">
          <SettingsCard>
            <div className="divide-y divide-border/70">
              <SimpleField label="Name">
                <Input
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Action name"
                  value={name}
                />
              </SimpleField>

              <SimpleField description="The first event that starts this action." label="Trigger">
                <Select
                  items={TRIGGER_OPTIONS.map((option) => ({
                    label: option.label,
                    value: option.value,
                  }))}
                  onValueChange={() => undefined}
                  value={trigger}
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
                        if (!value) return;
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
                      disabled={startingLinear || linearConnector?.isConfigured === false}
                      onClick={() => void startLinearConnection()}
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
                        <LinearBadge />
                      )}
                      Connect Linear
                    </Button>
                  )}
                  <Select
                    disabled={!credentialId || linearMetadataLoading}
                    items={teams.map((team) => ({
                      label: `${team.name} (${team.key})`,
                      value: team.id,
                    }))}
                    onValueChange={(value) => value && setTeamId(value)}
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
                  <textarea
                    aria-label="Action instruction"
                    className={cn(
                      "min-h-36 w-full resize-y rounded-md border border-input bg-background-light px-3 py-2 text-sm text-foreground outline-none squircle placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30",
                    )}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder={DEFAULT_ACTION_INSTRUCTIONS}
                    value={instructions}
                  />
                  <p className={settingsRowValueClass}>
                    Example: When it's a bug or feature request, use{" "}
                    <span className="rounded-full border border-[#5e6ad2]/40 bg-[#5e6ad2]/15 px-1.5 py-0.5 text-[#b8bef8]">
                      @Linear
                    </span>{" "}
                    to search for duplicate issues, then create one if needed.
                  </p>
                </div>
              </SimpleField>
            </div>
          </SettingsCard>

          {validationErrors.length > 0 ? (
            <SettingsCard className="border-destructive/35 bg-destructive/5 p-4">
              <p className={settingsRowTitleClass}>Missing before publish</p>
              <ul className="mt-2 space-y-1 text-sm text-destructive">
                {validationErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </SettingsCard>
          ) : null}

          <SettingsRows>
            <SettingsRow
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={saveDraftMutation.isPending}
                    onClick={saveDraft}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {saveDraftMutation.isPending ? (
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
                    onClick={() =>
                      activeActionId && publishMutation.mutate({ actionId: activeActionId })
                    }
                    size="sm"
                    type="button"
                  >
                    {publishMutation.isPending ? (
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
                    disabled={!hasPublished || setEnabledMutation.isPending}
                    onCheckedChange={(enabled) =>
                      activeActionId &&
                      setEnabledMutation.mutate({ actionId: activeActionId, enabled })
                    }
                  >
                    <SwitchThumb />
                  </Switch>
                </div>
              }
              title="Status"
            >
              {hasPublished
                ? isDirty
                  ? "Save changes before publishing or enabling the latest version."
                  : "Published actions can be enabled or disabled."
                : "Save and publish before enabling this action."}
            </SettingsRow>
          </SettingsRows>
        </SettingsSection>
      ) : (
        <SettingsCard className="p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SettingsRowText title="No action selected">
              Create an action to define what should happen when new mail arrives.
            </SettingsRowText>
            <Button
              disabled={!activeMailboxId || createActionMutation.isPending}
              onClick={createAction}
              size="sm"
              type="button"
            >
              {createActionMutation.isPending ? (
                <HugeiconsIcon aria-hidden className="size-4 animate-spin" icon={Loading03Icon} />
              ) : (
                <HugeiconsIcon aria-hidden className="size-4" icon={Add01Icon} />
              )}
              New action
            </Button>
          </div>
        </SettingsCard>
      )}
    </div>
  );
};

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
      <p className={settingsRowTitleClass}>{label}</p>
      {description ? <p className={cn("mt-1", settingsRowValueClass)}>{description}</p> : null}
    </div>
    <div className="min-w-0">{children}</div>
  </div>
);

const LinearBadge = () => (
  <span
    aria-hidden
    className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-[#5e6ad2] text-[10px] font-medium text-white"
  >
    L
  </span>
);

const getLinearAccountLabel = (
  account: NonNullable<ConnectorsData>["connectors"][number]["accounts"][number],
) => account.providerWorkspaceName ?? account.accountEmail ?? account.displayName ?? "Linear";

const getSimpleActionConfig = (graph: unknown) => {
  if (!graph || typeof graph !== "object") {
    return {
      credentialId: "",
      instructions: DEFAULT_ACTION_INSTRUCTIONS,
      teamId: "",
    };
  }

  const nodes = (graph as { nodes?: unknown }).nodes;
  const linearNode = Array.isArray(nodes)
    ? nodes.find(
        (node): node is { config?: Record<string, unknown>; type: "linear_agent_issue" } =>
          !!node &&
          typeof node === "object" &&
          "type" in node &&
          node.type === "linear_agent_issue",
      )
    : undefined;
  const config =
    linearNode &&
    "config" in linearNode &&
    linearNode.config &&
    typeof linearNode.config === "object"
      ? linearNode.config
      : {};

  return {
    credentialId: typeof config.credentialId === "string" ? config.credentialId : "",
    instructions:
      typeof config.instructions === "string" && config.instructions.trim()
        ? config.instructions
        : DEFAULT_ACTION_INSTRUCTIONS,
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
        credentialId: credentialId || undefined,
        instructions,
        teamId: teamId || undefined,
      },
      id: "linear",
      position: { x: 320, y: 0 },
      type: "linear_agent_issue",
    },
  ],
  version: MAILBOX_ACTION_GRAPH_VERSION,
});
