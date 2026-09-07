"use client";

import type {
  ManagedMailboxRuleAction,
  ManagedMailboxRuleConditionGroup,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import { parseStructuredSearchQuery } from "@quieter/mail/search";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { labelsQueryOptions } from "#/lib/gmail/labels-query";
import {
  getManagedRulesQueryKey,
  managedRulesQueryOptions,
} from "#/lib/managed-mailbox-organization-query";
import { orpc, rpc } from "#/lib/orpc";
import {
  getSavedViewsQueryKey,
  savedViewsQueryOptions,
} from "#/lib/saved-views-query";

import type {
  MailboxSavedView,
  PendingRowKind,
  PendingRowAction,
  MailboxOrganizerProps,
  ReorderScope,
  RuleActionKind,
  RuleMatchMode,
  RuleMoveDestination,
} from "./mailbox-organizer-types";
import { useManagedMailboxRuleActions } from "./mailbox-rule-actions";
import { useMailboxViewActions } from "./mailbox-view-actions";

type EditingView = {
  color: MailboxLabelColor;
  name: string;
  view: MailboxSavedView;
};

const getPendingRowActionKey = (
  kind: PendingRowKind,
  id: string,
  action: PendingRowAction
) => `${kind}:${id}:${action}`;

export const useMailboxOrganizerState = ({
  canManage,
  mailboxId,
  searchQuery,
  supportsRules,
}: MailboxOrganizerProps) => {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [newViewColor, setNewViewColor] = useState<MailboxLabelColor>("gray");
  const [viewName, setViewName] = useState("");
  const [editingView, setEditingView] = useState<EditingView | null>(null);
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
  const [pendingReorders, setPendingReorders] = useState<
    Partial<Record<ReorderScope, string>>
  >({});
  const { data: viewsData } = useQuery(savedViewsQueryOptions(mailboxId));
  const { data: rulesData } = useQuery(
    managedRulesQueryOptions(mailboxId, isOpen && canManage && supportsRules)
  );
  const { data: labelsData } = useQuery(
    labelsQueryOptions(mailboxId, isOpen && supportsRules)
  );
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
  const currentSearch = parseStructuredSearchQuery(searchQuery);
  const views = viewsData ?? [];
  const sharedViews = views.filter((view) => view.ownerUserId === null);
  const personalViews = views.filter((view) => view.ownerUserId !== null);

  const invalidateViews = async () => {
    await queryClient.invalidateQueries({
      queryKey: getSavedViewsQueryKey(mailboxId),
    });
  };
  const invalidateRules = async () => {
    await queryClient.invalidateQueries({
      queryKey: getManagedRulesQueryKey(mailboxId),
    });
  };
  const createViewMutation = useMutation(
    orpc.mail.createSavedView.mutationOptions()
  );
  const deleteViewMutation = useMutation(
    orpc.mail.deleteSavedView.mutationOptions()
  );
  const updateViewMutation = useMutation(
    orpc.mail.updateSavedView.mutationOptions()
  );
  const reorderViewsMutation = useMutation(
    orpc.mail.reorderSavedViews.mutationOptions()
  );
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

  const isRowActionPending = (
    kind: PendingRowKind,
    id: string,
    action: PendingRowAction
  ) => pendingRowActions[getPendingRowActionKey(kind, id, action)];

  const runRowAction = async <T,>(
    kind: PendingRowKind,
    id: string,
    action: PendingRowAction,
    operation: () => Promise<T>
  ) => {
    const key = getPendingRowActionKey(kind, id, action);
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

  const runReorder = async <T,>(
    scope: ReorderScope,
    rowId: string,
    operation: () => Promise<T>
  ) => {
    setPendingReorders((current) => ({ ...current, [scope]: rowId }));
    return await operation().finally(() => {
      setPendingReorders((current) => {
        if (current[scope] !== rowId) {
          return current;
        }
        const next = { ...current };
        Reflect.deleteProperty(next, scope);
        return next;
      });
    });
  };

  const editingRuleUpdatePending =
    editingRuleId !== null &&
    isRowActionPending("rule", editingRuleId, "update");
  const editingViewUpdatePending =
    editingView !== null &&
    isRowActionPending("view", editingView.view.id, "update");

  return {
    activeBackfillId,
    backfillData,
    backfillMutation,
    cancelBackfillMutation,
    createRuleMutation,
    createViewMutation,
    currentSearch,
    deleteRuleMutation,
    deleteViewMutation,
    editingRuleId,
    editingRuleUpdatePending,
    editingView,
    editingViewUpdatePending,
    invalidateRules,
    invalidateViews,
    isOpen,
    isRowActionPending,
    labelsData,
    newViewColor,
    pendingReorders,
    pendingRowActions,
    personalViews,
    preview,
    previewRuleMutation,
    reorderRulesMutation,
    reorderViewsMutation,
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
    setEditingView,
    setIsOpen,
    setNewViewColor,
    setPendingReorders,
    setPendingRowActions,
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
    setViewName,
    sharedViews,
    updateRuleMutation,
    updateViewMutation,
    viewName,
    views,
    viewsData,
  };
};

export const useMailboxOrganizerController = (props: MailboxOrganizerProps) => {
  const state = useMailboxOrganizerState(props);
  const viewActions = useMailboxViewActions({
    currentSearch: state.currentSearch,
    mailboxId: props.mailboxId,
    state,
  });
  const ruleActions = useManagedMailboxRuleActions({
    mailboxId: props.mailboxId,
    state,
  });

  return { ...state, ...viewActions, ...ruleActions };
};
