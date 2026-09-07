"use client";

import type { RouterOutputs } from "@quieter/orpc";
import { MAILBOX_ACTION_GRAPH_VERSION } from "@quieter/orpc/mailbox-actions/graph";
import type { MailboxActionGraph } from "@quieter/orpc/mailbox-actions/graph";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  CONNECTORS_QUERY_KEY,
  openConnectorLink,
} from "#/lib/connectors-query";
import { toastError } from "#/lib/error-toast";
import {
  mailboxActionQueryKey,
  mailboxActionsListQueryKey,
} from "#/lib/mailbox-actions-query";
import { orpc } from "#/lib/orpc";

import type {
  ConnectorProvider,
  MailboxActionDetail,
  MailboxActionRevision,
  ConnectorsData,
} from "./action-editor-types";

type MailboxActionQueryData = RouterOutputs["mailboxActions"]["get"];

const isConnectorAgentNode = (
  node: unknown
): node is { config?: Record<string, unknown>; type: "connector_agent" } => {
  if (node === null || node === undefined || typeof node !== "object") {
    return false;
  }
  return "type" in node && node.type === "connector_agent";
};

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

const hasEditorValue = (value: string | null | undefined): value is string =>
  value !== undefined && value !== "";

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
      toastError(error, {
        boundary: "mailbox-actions",
        fallback: "Could not save action.",
      });
    },
    onSuccess: async (result) => {
      await invalidateActionQueries();
      notifySavedAction(result.validationStatus);
    },
  });
  const publishMutation = useMutation({
    ...orpc.mailboxActions.publish.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "mailbox-actions",
        fallback: "Could not publish action.",
      });
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
      toastError(error, {
        boundary: "mailbox-actions",
        fallback: "Could not update action.",
      });
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
      toastError(error, {
        boundary: "mailbox-actions",
        fallback: "Could not delete action.",
      });
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

export const useActionEditorController = ({
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
      toastError(error, {
        boundary: "mailbox-actions",
        fallback: "Could not start setup.",
      });
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
