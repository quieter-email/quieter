"use client";

import type {
  ManagedMailboxRuleAction,
  ManagedMailboxRuleConditionGroup,
} from "@quieter/mail/mailbox-organization";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { labelsQueryOptions } from "#/lib/mail/labels-query";
import {
  getManagedRulesQueryKey,
  managedRulesQueryOptions,
} from "#/lib/managed-mailbox-organization-query";
import { orpc, rpc } from "#/lib/orpc";

import type {
  PendingRowAction,
  MailboxOrganizerProps,
  RuleActionKind,
  RuleMatchMode,
  RuleMoveDestination,
} from "./mailbox-organizer-types";
import { useManagedMailboxRuleActions } from "./mailbox-rule-actions";

const getPendingRowActionKey = (id: string, action: PendingRowAction) =>
  `${id}:${action}`;

export const useMailboxOrganizerState = ({
  canManage,
  mailboxId,
  searchQuery,
}: MailboxOrganizerProps) => {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [ruleQueryDraft, setRuleQueryDraft] = useState<string | null>(null);
  const ruleQuery = ruleQueryDraft ?? searchQuery;
  const [ruleMatchMode, setRuleMatchMode] = useState<RuleMatchMode>("all");
  const ruleConditionGroupsRef = useRef<
    ManagedMailboxRuleConditionGroup[] | null
  >(null);
  const ruleActionsRef = useRef<ManagedMailboxRuleAction[]>([]);
  const ruleEnabledRef = useRef(true);
  const [ruleActionKind, setRuleActionKind] =
    useState<RuleActionKind>("set-labels");
  const [ruleReadState, setRuleReadState] = useState(true);
  const [ruleMoveDestination, setRuleMoveDestination] =
    useState<RuleMoveDestination>("archive");
  const [ruleForwardRecipients, setRuleForwardRecipients] = useState("");
  const [ruleForwardIncludesAttachments, setRuleForwardIncludesAttachments] =
    useState(false);
  const [ruleStopsProcessing, setRuleStopsProcessing] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [selectedRuleLabelIds, setSelectedRuleLabelIds] = useState<string[]>(
    []
  );
  const selectedRuleLabelIdSet = new Set(selectedRuleLabelIds);
  const [activeBackfillId, setActiveBackfillId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    count: number;
    samples: { id: string }[];
  } | null>(null);
  const [pendingRowActions, setPendingRowActions] = useState<
    Record<string, true>
  >({});
  const [pendingReorderRuleId, setPendingReorderRuleId] = useState<
    string | null
  >(null);
  const { data: rulesData } = useQuery(
    managedRulesQueryOptions(mailboxId, isOpen && canManage)
  );
  const { data: labelsData } = useQuery(labelsQueryOptions(mailboxId, isOpen));
  const { data: backfillData } = useQuery({
    enabled: activeBackfillId !== null && activeBackfillId !== "",
    queryFn: async ({ signal }) =>
      await rpc.mail.getManagedRuleBackfill(
        { backfillId: activeBackfillId ?? "", mailboxId },
        { signal }
      ),
    queryKey: ["managed-rule-backfill", mailboxId, activeBackfillId],
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "running" ? 1000 : false;
    },
  });

  const invalidateRules = async () => {
    await queryClient.invalidateQueries({
      queryKey: getManagedRulesQueryKey(mailboxId),
    });
  };
  const createRuleMutation = useMutation(
    orpc.mail.createManagedRule.mutationOptions()
  );
  const deleteRuleMutation = useMutation(
    orpc.mail.deleteManagedRule.mutationOptions()
  );
  const reorderRulesMutation = useMutation(
    orpc.mail.reorderManagedRules.mutationOptions()
  );
  const updateRuleMutation = useMutation(
    orpc.mail.updateManagedRule.mutationOptions()
  );
  const previewRuleMutation = useMutation(
    orpc.mail.previewManagedRule.mutationOptions()
  );
  const backfillMutation = useMutation(
    orpc.mail.startManagedRuleBackfill.mutationOptions()
  );
  const cancelBackfillMutation = useMutation(
    orpc.mail.cancelManagedRuleBackfill.mutationOptions()
  );

  const isRowActionPending = (id: string, action: PendingRowAction) =>
    pendingRowActions[getPendingRowActionKey(id, action)];

  const runRowAction = async <T,>(
    id: string,
    action: PendingRowAction,
    operation: () => Promise<T>
  ) => {
    const key = getPendingRowActionKey(id, action);
    setPendingRowActions((current) => ({ ...current, [key]: true }));
    return await operation().finally(() => {
      setPendingRowActions((current) => {
        if (!current[key]) {
          return current;
        }
        const next = { ...current };
        Reflect.deleteProperty(next, key);
        return next;
      });
    });
  };

  const runReorder = async <T,>(rowId: string, operation: () => Promise<T>) => {
    setPendingReorderRuleId(rowId);
    return await operation().finally(() => {
      setPendingReorderRuleId((current) =>
        current === rowId ? null : current
      );
    });
  };

  const editingRuleUpdatePending =
    editingRuleId !== null && isRowActionPending(editingRuleId, "update");

  return {
    activeBackfillId,
    backfillData,
    backfillMutation,
    cancelBackfillMutation,
    createRuleMutation,
    deleteRuleMutation,
    editingRuleId,
    editingRuleUpdatePending,
    invalidateRules,
    isOpen,
    isRowActionPending,
    labelsData,
    pendingReorderRuleId,
    preview,
    previewRuleMutation,
    reorderRulesMutation,
    ruleActionKind,
    ruleActionsRef,
    ruleConditionGroupsRef,
    ruleEnabledRef,
    ruleForwardIncludesAttachments,
    ruleForwardRecipients,
    ruleMatchMode,
    ruleMoveDestination,
    ruleName,
    ruleQuery,
    ruleQueryDraft,
    ruleReadState,
    ruleStopsProcessing,
    rulesData,
    runReorder,
    runRowAction,
    selectedRuleLabelIdSet,
    selectedRuleLabelIds,
    setActiveBackfillId,
    setEditingRuleId,
    setIsOpen,
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
    updateRuleMutation,
  };
};

export const useMailboxOrganizerController = (props: MailboxOrganizerProps) => {
  const state = useMailboxOrganizerState(props);
  const ruleActions = useManagedMailboxRuleActions({
    mailboxId: props.mailboxId,
    state,
  });

  return { ...state, ...ruleActions };
};
