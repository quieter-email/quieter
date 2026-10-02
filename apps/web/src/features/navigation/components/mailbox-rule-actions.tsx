"use client";

import type {
  ManagedMailboxRuleAction,
  ManagedMailboxRuleConditionGroup,
} from "@quieter/mail/mailbox-organization";
import { parseStructuredSearchQuery } from "@quieter/mail/search";
import type { RouterOutputs } from "@quieter/orpc";
import { useQueryClient } from "@tanstack/react-query";

import { toastError } from "#/lib/error-toast";
import { getManagedRulesQueryKey } from "#/lib/managed-mailbox-organization-query";

import type {
  RuleActionKind,
  RuleMatchMode,
  RuleMoveDestination,
  PendingRowAction,
  MailboxOrganizerState,
} from "./mailbox-organizer-types";

type CreateManagedRuleDefinitionInput = {
  actionKind: RuleActionKind;
  actions: ManagedMailboxRuleAction[];
  conditionGroups: ManagedMailboxRuleConditionGroup[] | null;
  editingRuleId: string | null;
  enabled: boolean;
  forwardIncludesAttachments: boolean;
  forwardRecipients: string;
  matchMode: RuleMatchMode;
  moveDestination: RuleMoveDestination;
  name: string;
  query: string;
  readState: boolean;
  selectedLabelIds: string[];
  stopProcessing: boolean;
};

const createManagedRuleDefinition = ({
  actionKind,
  actions: existingActions,
  conditionGroups,
  editingRuleId,
  enabled,
  forwardIncludesAttachments,
  forwardRecipients,
  matchMode,
  moveDestination,
  name,
  query,
  readState,
  selectedLabelIds,
  stopProcessing,
}: CreateManagedRuleDefinitionInput) => {
  let primaryAction: ManagedMailboxRuleAction;
  if (actionKind === "set-labels") {
    primaryAction = {
      addIds: selectedLabelIds,
      kind: "set-labels",
      removeIds: [],
    };
  } else if (actionKind === "set-read") {
    primaryAction = { kind: "set-read", read: readState };
  } else if (actionKind === "move") {
    primaryAction = { destination: moveDestination, kind: "move" };
  } else {
    primaryAction = {
      includeAttachments: forwardIncludesAttachments,
      kind: "forward",
      recipients: forwardRecipients
        .split(/[,;\n]/u)
        .map((recipient) => recipient.trim())
        .filter((recipient) => recipient.length > 0),
    };
  }

  const primaryActionIndex = existingActions.findIndex(
    (action) => action.kind !== "stop-processing"
  );
  const hasEditingRuleId = editingRuleId !== null && editingRuleId !== "";
  const actions: ManagedMailboxRuleAction[] = hasEditingRuleId
    ? existingActions.flatMap((action, index) => {
        if (action.kind === "stop-processing") {
          return [];
        }
        return index === primaryActionIndex ? [primaryAction] : [action];
      })
    : [primaryAction];

  if (hasEditingRuleId && primaryActionIndex === -1) {
    actions.unshift(primaryAction);
  }
  if (stopProcessing) {
    actions.push({ kind: "stop-processing" });
  }

  return {
    actions,
    conditionGroups: conditionGroups ?? undefined,
    enabled,
    labelIds: actions.flatMap((action) =>
      action.kind === "set-labels" ? action.addIds : []
    ),
    matchMode,
    name: name.trim(),
    search: parseStructuredSearchQuery(query),
  };
};

export const useManagedMailboxRuleActions = ({
  mailboxId,
  state,
}: {
  mailboxId: string;
  state: MailboxOrganizerState;
}) => {
  const {
    cancelBackfillMutation,
    createRuleMutation,
    editingRuleId,
    invalidateRules,
    previewRuleMutation,
    ruleActionKind,
    ruleConditionGroupsRef,
    ruleEnabledRef,
    ruleForwardIncludesAttachments,
    ruleForwardRecipients,
    ruleMatchMode,
    ruleMoveDestination,
    ruleName,
    ruleReadState,
    ruleStopsProcessing,
    ruleQuery,
    ruleActionsRef,
    selectedRuleLabelIds,
    setEditingRuleId,
    setPreview,
    setRuleActionKind,
    setRuleForwardIncludesAttachments,
    setRuleForwardRecipients,
    setRuleMatchMode,
    setRuleMoveDestination,
    setRuleName,
    setRuleQueryDraft,
    setRuleReadState,
    setRuleStopsProcessing,
    setSelectedRuleLabelIds,
    runReorder,
    runRowAction,
    updateRuleMutation,
  } = state;
  const queryClient = useQueryClient();

  const runRuleRowAction = async <T,>(
    id: string,
    action: PendingRowAction,
    operation: () => Promise<T>,
    fallback: string,
    onSuccess?: (result: T) => void
  ) => {
    try {
      const result = await runRowAction(id, action, operation);
      await invalidateRules();
      onSuccess?.(result);
    } catch (error) {
      toastError(error, { boundary: "mailbox-organizer", fallback });
    }
  };

  /**
   * Enabling a rule is reversible, so the switch moves at once instead of
   * showing a spinner, and the previous rule list is restored if the write
   * fails.
   */
  const runOptimisticRuleUpdate = async (
    ruleId: string,
    enabled: boolean,
    operation: () => Promise<unknown>
  ) => {
    const rulesKey = getManagedRulesQueryKey(mailboxId);
    await queryClient.cancelQueries({ queryKey: rulesKey });
    const previous =
      queryClient.getQueryData<RouterOutputs["mail"]["listManagedRules"]>(
        rulesKey
      );
    queryClient.setQueryData<RouterOutputs["mail"]["listManagedRules"]>(
      rulesKey,
      (current) =>
        current?.map((entry) =>
          entry.id === ruleId ? { ...entry, enabled } : entry
        )
    );

    try {
      await operation();
    } catch (error) {
      queryClient.setQueryData(rulesKey, previous);
      toastError(error, {
        boundary: "mailbox-organizer",
        fallback: "Could not update rule.",
      });
      return;
    }
    await invalidateRules();
  };

  const runRuleReorder = async <T,>(
    rowId: string,
    operation: () => Promise<T>,
    fallback: string
  ) => {
    try {
      await runReorder(rowId, operation);
      await invalidateRules();
    } catch (error) {
      toastError(error, { boundary: "mailbox-organizer", fallback });
    }
  };

  const createRuleDefinition = () =>
    createManagedRuleDefinition({
      actionKind: ruleActionKind,
      actions: ruleActionsRef.current,
      conditionGroups: ruleConditionGroupsRef.current,
      editingRuleId,
      enabled: ruleEnabledRef.current,
      forwardIncludesAttachments: ruleForwardIncludesAttachments,
      forwardRecipients: ruleForwardRecipients,
      matchMode: ruleMatchMode,
      moveDestination: ruleMoveDestination,
      name: ruleName,
      query: ruleQuery,
      readState: ruleReadState,
      selectedLabelIds: selectedRuleLabelIds,
      stopProcessing: ruleStopsProcessing,
    });

  const previewRule = async () => {
    try {
      const result = await previewRuleMutation.mutateAsync({
        definition: createRuleDefinition(),
        mailboxId,
      });
      setPreview(result);
    } catch (error) {
      toastError(error, {
        boundary: "mailbox-organizer",
        fallback: "Could not preview rule.",
      });
    }
  };

  const saveRule = async () => {
    const name = ruleName.trim();
    const query = ruleQuery.trim();
    const labelsInvalid =
      ruleActionKind === "set-labels" && selectedRuleLabelIds.length === 0;
    const recipientsInvalid =
      ruleActionKind === "forward" && ruleForwardRecipients.trim().length === 0;
    if (
      name.length === 0 ||
      query.length === 0 ||
      labelsInvalid ||
      recipientsInvalid
    ) {
      return;
    }
    try {
      if (editingRuleId !== null && editingRuleId !== "") {
        await runRowAction(
          editingRuleId,
          "update",
          async () =>
            await updateRuleMutation.mutateAsync({
              definition: createRuleDefinition(),
              mailboxId,
              ruleId: editingRuleId,
            })
        );
      } else {
        await createRuleMutation.mutateAsync({
          definition: createRuleDefinition(),
          mailboxId,
        });
      }
      setRuleName("");
      setRuleQueryDraft("");
      setRuleMatchMode("all");
      ruleConditionGroupsRef.current = null;
      ruleActionsRef.current = [];
      ruleEnabledRef.current = true;
      setRuleActionKind("set-labels");
      setRuleReadState(true);
      setRuleMoveDestination("archive");
      setRuleForwardRecipients("");
      setRuleForwardIncludesAttachments(false);
      setRuleStopsProcessing(false);
      setSelectedRuleLabelIds([]);
      setEditingRuleId(null);
      setPreview(null);
      await invalidateRules();
    } catch (error) {
      toastError(error, {
        boundary: "mailbox-organizer",
        fallback: "Could not save rule.",
      });
    }
  };

  const cancelBackfill = async (backfillId: string) => {
    try {
      await cancelBackfillMutation.mutateAsync({ backfillId, mailboxId });
    } catch (error) {
      toastError(error, {
        boundary: "mailbox-organizer",
        fallback: "Could not cancel the historical rule run.",
      });
    }
  };

  return {
    cancelBackfill,
    createRuleDefinition,
    previewRule,
    runOptimisticRuleUpdate,
    runRuleReorder,
    runRuleRowAction,
    saveRule,
  };
};
