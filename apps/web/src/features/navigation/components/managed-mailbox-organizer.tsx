"use client";

import {
  ArrowLeft02Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Delete01Icon,
  Edit01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  getManagedMailboxRuleActions,
  mailboxLabelColorSchema,
  managedMailboxRuleConditionGroupSchema,
} from "@quieter/mail/mailbox-organization";
import type {
  ManagedMailboxRuleAction,
  ManagedMailboxRuleConditionGroup,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import {
  areStructuredMailSearchesEqual,
  parseStructuredSearchQuery,
  serializeStructuredSearchState,
  structuredMailSearchSchema,
} from "@quieter/mail/search";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import {
  FullPageDialog,
  FullPageDialogBody,
  FullPageDialogClose,
  FullPageDialogContent,
  FullPageDialogDescription,
  FullPageDialogHeader,
  FullPageDialogTitle,
} from "@quieter/ui/full-page-dialog";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { MailboxColorPicker } from "#/features/message-labels/components/mailbox-color-picker";
import { mailboxLabelDotClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";
import { labelsQueryOptions } from "#/lib/gmail/labels-query";
import {
  getManagedRulesQueryKey,
  getManagedSavedViewsQueryKey,
  managedRulesQueryOptions,
  managedSavedViewsQueryOptions,
} from "#/lib/managed-mailbox-organization-query";
import { orpc, rpc } from "#/lib/orpc";

import { SidebarNavItem } from "./sidebar-nav-item";

type ManagedMailboxOrganizerProps = {
  canManage: boolean;
  mailboxId: string;
  onSearch: (query: string) => void;
  searchQuery: string;
};

type ManagedSavedView = RouterOutputs["mail"]["listManagedSavedViews"][number];
type EditingView = {
  color: MailboxLabelColor;
  name: string;
  view: ManagedSavedView;
};
type SavedViewsSectionProps = {
  currentSearch: ReturnType<typeof parseStructuredSearchQuery>;
  emptyMessage: string;
  onSearch: (query: string) => void;
  title: string;
  views: ManagedSavedView[];
};

const getSearchFromStoredValue = (value: unknown) =>
  structuredMailSearchSchema.parse(value);
const getSavedViewColor = (color: string | null) =>
  color === null || color === ""
    ? "gray"
    : mailboxLabelColorSchema.parse(color);
const getPrimaryRuleAction = (actions: readonly ManagedMailboxRuleAction[]) =>
  actions.find((action) => action.kind !== "stop-processing") ?? actions[0];
const getRuleActionLabel = (actions: readonly ManagedMailboxRuleAction[]) => {
  const action = getPrimaryRuleAction(actions);
  if (action === undefined) {
    return "No action";
  }
  if (action.kind === "set-labels") {
    return "Apply labels";
  }
  if (action.kind === "set-read") {
    return action.read ? "Mark read" : "Mark unread";
  }
  if (action.kind === "move") {
    return action.destination === "inbox"
      ? "Move to Inbox"
      : `Move to ${action.destination[0]?.toUpperCase()}${action.destination.slice(1)}`;
  }
  if (action.kind === "forward") {
    return `Forward to ${action.recipients.join(", ")}`;
  }
  return "Stop processing";
};
const getRuleConditionGroups = (conditionGroups: unknown) => {
  const parsed = managedMailboxRuleConditionGroupSchema
    .array()
    .safeParse(conditionGroups);
  return parsed.success ? parsed.data : undefined;
};
const hasInvalidRuleConditionGroups = (
  storedConditionGroups: unknown,
  conditionGroups: ManagedMailboxRuleConditionGroup[] | undefined
) =>
  storedConditionGroups !== null &&
  storedConditionGroups !== undefined &&
  conditionGroups === undefined;

type PendingRowKind = "rule" | "view";
type PendingRowAction = "backfill" | "delete" | "duplicate" | "update";
type ReorderScope = "rules" | "views:personal" | "views:shared";

const getPendingRowActionKey = (
  kind: PendingRowKind,
  id: string,
  action: PendingRowAction
) => `${kind}:${id}:${action}`;

const SavedViewsSection = ({
  currentSearch,
  emptyMessage,
  onSearch,
  title,
  views,
}: SavedViewsSectionProps) => (
  <section className="mt-4">
    <p className="mb-1 px-2 text-xs font-medium text-muted-fg">{title}</p>
    {views.length === 0 ? (
      <p className="px-2 py-1 text-xs text-muted-fg">{emptyMessage}</p>
    ) : (
      <nav aria-label={title} className="flex flex-col">
        {views.map((view) => {
          const search = getSearchFromStoredValue(view.search);
          const active = areStructuredMailSearchesEqual(currentSearch, search);
          return (
            <SidebarNavItem
              active={active}
              aria-current={active ? "page" : undefined}
              className={cn(
                "squircle h-7 w-full min-w-0 justify-start gap-2 rounded-md px-2.5 text-left text-xs font-light",
                {
                  "text-fg": active,
                  "text-muted-fg": !active,
                }
              )}
              key={view.id}
              onClick={() => {
                onSearch(serializeStructuredSearchState(search));
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  mailboxLabelDotClassNameByColor[getSavedViewColor(view.color)]
                )}
              />
              <span className="truncate">{view.name}</span>
            </SidebarNavItem>
          );
        })}
      </nav>
    )}
  </section>
);

type RuleActionKind = "forward" | "move" | "set-labels" | "set-read";
type RuleMatchMode = "all" | "any";
type RuleMoveDestination = "archive" | "inbox" | "spam" | "trash";

type RuleInputValidityParams = {
  actionKind: RuleActionKind;
  forwardRecipients: string;
  name: string;
  query: string;
  selectedLabelIds: string[];
};

const hasValidRuleInput = ({
  actionKind,
  forwardRecipients,
  name,
  query,
  selectedLabelIds,
}: RuleInputValidityParams) => {
  if (name.trim().length === 0 || query.trim().length === 0) {
    return false;
  }
  if (actionKind === "set-labels" && selectedLabelIds.length === 0) {
    return false;
  }
  if (actionKind === "forward" && forwardRecipients.trim().length === 0) {
    return false;
  }
  return true;
};

const useManagedMailboxOrganizerState = ({
  canManage,
  mailboxId,
  searchQuery,
}: ManagedMailboxOrganizerProps) => {
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
  const { data: viewsData } = useQuery(
    managedSavedViewsQueryOptions(mailboxId)
  );
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
  const currentSearch = parseStructuredSearchQuery(searchQuery);
  const views = viewsData ?? [];
  const sharedViews = views.filter((view) => view.ownerUserId === null);
  const personalViews = views.filter((view) => view.ownerUserId !== null);

  const invalidateViews = async () => {
    await queryClient.invalidateQueries({
      queryKey: getManagedSavedViewsQueryKey(mailboxId),
    });
  };
  const invalidateRules = async () => {
    await queryClient.invalidateQueries({
      queryKey: getManagedRulesQueryKey(mailboxId),
    });
  };
  const createViewMutation = useMutation(
    orpc.mail.createManagedSavedView.mutationOptions()
  );
  const deleteViewMutation = useMutation(
    orpc.mail.deleteManagedSavedView.mutationOptions()
  );
  const updateViewMutation = useMutation(
    orpc.mail.updateManagedSavedView.mutationOptions()
  );
  const reorderViewsMutation = useMutation(
    orpc.mail.reorderManagedSavedViews.mutationOptions()
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
    try {
      return await operation();
    } finally {
      setPendingRowActions((current) => {
        if (!current[key]) {
          return current;
        }
        const next = { ...current };
        Reflect.deleteProperty(next, key);
        return next;
      });
    }
  };

  const runReorder = async <T,>(
    scope: ReorderScope,
    rowId: string,
    operation: () => Promise<T>
  ) => {
    setPendingReorders((current) => ({ ...current, [scope]: rowId }));
    try {
      return await operation();
    } finally {
      setPendingReorders((current) => {
        if (current[scope] !== rowId) {
          return current;
        }
        const next = { ...current };
        Reflect.deleteProperty(next, scope);
        return next;
      });
    }
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

type ManagedMailboxOrganizerState = ReturnType<
  typeof useManagedMailboxOrganizerState
>;

const useManagedMailboxViewActions = ({
  currentSearch,
  mailboxId,
  state,
}: {
  currentSearch: ReturnType<typeof parseStructuredSearchQuery>;
  mailboxId: string;
  state: ManagedMailboxOrganizerState;
}) => {
  const {
    createViewMutation,
    editingView,
    invalidateViews,
    newViewColor,
    runReorder,
    runRowAction,
    setEditingView,
    setNewViewColor,
    setViewName,
    updateViewMutation,
    viewName,
  } = state;

  const runViewRowAction = async <T,>(
    kind: PendingRowKind,
    id: string,
    action: PendingRowAction,
    operation: () => Promise<T>,
    fallback: string
  ) => {
    try {
      await runRowAction(kind, id, action, operation);
      await invalidateViews();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback);
    }
  };

  const runViewReorder = async <T,>(
    scope: ReorderScope,
    rowId: string,
    operation: () => Promise<T>,
    fallback: string
  ) => {
    try {
      await runReorder(scope, rowId, operation);
      await invalidateViews();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback);
    }
  };

  const saveView = async (shared: boolean) => {
    const name = viewName.trim();
    if (name.length === 0) {
      return;
    }
    try {
      await createViewMutation.mutateAsync({
        definition: {
          color: newViewColor,
          icon: null,
          name,
          search: currentSearch,
          sort: "newest",
        },
        mailboxId,
        shared,
      });
      setNewViewColor("gray");
      setViewName("");
      await invalidateViews();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save view."
      );
    }
  };

  const saveViewEdit = async () => {
    if (editingView === null || editingView.name.trim().length === 0) {
      return;
    }
    try {
      await runRowAction(
        "view",
        editingView.view.id,
        "update",
        async () =>
          await updateViewMutation.mutateAsync({
            definition: {
              color: editingView.color,
              icon: editingView.view.icon,
              name: editingView.name.trim(),
              search: getSearchFromStoredValue(editingView.view.search),
              sort: editingView.view.sort,
            },
            mailboxId,
            viewId: editingView.view.id,
          })
      );
      setEditingView(null);
      await invalidateViews();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update view."
      );
    }
  };

  return {
    runViewReorder,
    runViewRowAction,
    saveView,
    saveViewEdit,
  };
};

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

const useManagedMailboxRuleActions = ({
  mailboxId,
  state,
}: {
  mailboxId: string;
  state: ManagedMailboxOrganizerState;
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

  const runRuleRowAction = async <T,>(
    kind: PendingRowKind,
    id: string,
    action: PendingRowAction,
    operation: () => Promise<T>,
    fallback: string,
    onSuccess?: (result: T) => void
  ) => {
    try {
      const result = await runRowAction(kind, id, action, operation);
      await invalidateRules();
      onSuccess?.(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback);
    }
  };

  const runRuleReorder = async <T,>(
    rowId: string,
    operation: () => Promise<T>,
    fallback: string
  ) => {
    try {
      await runReorder("rules", rowId, operation);
      await invalidateRules();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallback);
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
      toast.error(
        error instanceof Error ? error.message : "Could not preview rule."
      );
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
          "rule",
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
      toast.error(
        error instanceof Error ? error.message : "Could not save rule."
      );
    }
  };

  const cancelBackfill = async (backfillId: string) => {
    try {
      await cancelBackfillMutation.mutateAsync({ backfillId, mailboxId });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not cancel the historical rule run."
      );
    }
  };

  return {
    cancelBackfill,
    createRuleDefinition,
    previewRule,
    runRuleReorder,
    runRuleRowAction,
    saveRule,
  };
};

const useManagedMailboxOrganizerController = (
  props: ManagedMailboxOrganizerProps
) => {
  const state = useManagedMailboxOrganizerState(props);
  const viewActions = useManagedMailboxViewActions({
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

type ManagedMailboxOrganizerController = ReturnType<
  typeof useManagedMailboxOrganizerController
>;
type ManagedMailboxOrganizerContentProps = ManagedMailboxOrganizerProps &
  ManagedMailboxOrganizerController;

const ManagedMailboxOrganizerSidebar = (
  props: ManagedMailboxOrganizerContentProps
) => {
  const {
    currentSearch,
    onSearch,
    personalViews,
    searchQuery,
    setIsOpen,
    setRuleQueryDraft,
    sharedViews,
  } = props;

  return (
    <div className="flex items-center justify-between">
      <div className="min-w-0 flex-1">
        <SavedViewsSection
          currentSearch={currentSearch}
          emptyMessage="No shared views."
          onSearch={onSearch}
          title="Views"
          views={sharedViews}
        />
        <SavedViewsSection
          currentSearch={currentSearch}
          emptyMessage="No personal views."
          onSearch={onSearch}
          title="My views"
          views={personalViews}
        />
      </div>
      <IconButtonTooltip label="Manage views and rules">
        <Button
          aria-label="Manage views and rules"
          className="mt-4 size-6 self-start text-muted-fg hover:text-fg"
          onClick={() => {
            setRuleQueryDraft(searchQuery);
            setIsOpen(true);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden className="size-3.5" icon={Edit01Icon} />
        </Button>
      </IconButtonTooltip>
    </div>
  );
};

const ManagedMailboxSavedViewsPanel = (
  props: ManagedMailboxOrganizerContentProps
) => {
  const {
    canManage,
    createViewMutation,
    currentSearch,
    deleteViewMutation,
    isRowActionPending,
    mailboxId,
    newViewColor,
    pendingReorders,
    reorderViewsMutation,
    runViewReorder,
    runViewRowAction,
    saveView,
    setEditingView,
    setNewViewColor,
    setViewName,
    updateViewMutation,
    viewName,
    views,
  } = props;

  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">Saved views</h2>
      <FullPageDialogDescription className="mt-1">
        Save the current search for quick access from the sidebar.
      </FullPageDialogDescription>
      <div className="squircle mt-5 rounded-xl bg-secondary/40 p-3">
        <div className="flex gap-2">
          <Input
            aria-label="Saved view name"
            className="border-0 bg-bg/70 shadow-none"
            onChange={(event) => {
              setViewName(event.target.value);
            }}
            placeholder="View name"
            size="sm"
            value={viewName}
          />
          <Button
            disabled={!viewName.trim() || createViewMutation.isPending}
            onClick={() => void saveView(false)}
            pending={createViewMutation.isPending}
            pendingLabel="Saving…"
            size="sm"
            type="button"
          >
            Save mine
          </Button>
          {canManage ? (
            <Button
              disabled={!viewName.trim() || createViewMutation.isPending}
              onClick={() => void saveView(true)}
              pending={createViewMutation.isPending}
              pendingLabel="Saving…"
              size="sm"
              type="button"
              variant="ghost"
            >
              Save shared
            </Button>
          ) : null}
        </div>
        <MailboxColorPicker
          className="mt-3"
          label="Saved view color"
          onChange={setNewViewColor}
          value={newViewColor}
        />
      </div>
      <div className="mt-5 space-y-1">
        {views.map((view) => {
          const viewScope: ReorderScope =
            view.ownerUserId === null ? "views:shared" : "views:personal";
          const sameScopeViews = views.filter(
            (candidate) =>
              (candidate.ownerUserId === null) === (view.ownerUserId === null)
          );
          const scopeIndex = sameScopeViews.findIndex(
            (candidate) => candidate.id === view.id
          );
          const reorderLocked = pendingReorders[viewScope] !== undefined;
          const reorderPending = pendingReorders[viewScope] === view.id;

          return (
            <div
              className="squircle flex items-center gap-3 rounded-lg p-2 hover:bg-secondary/25"
              key={view.id}
            >
              <span
                aria-hidden
                className={cn(
                  "size-3 shrink-0 rounded-full",
                  mailboxLabelDotClassNameByColor[getSavedViewColor(view.color)]
                )}
              />
              <span className="min-w-0 flex-1 truncate text-sm">
                {view.name}
              </span>
              <span className="text-xs text-muted-fg">
                {view.ownerUserId === null ? "Shared" : "Personal"}
              </span>
              {(view.ownerUserId !== null || canManage) && (
                <IconButtonTooltip label={`Edit ${view.name}`}>
                  <Button
                    aria-label={`Edit ${view.name}`}
                    onClick={() => {
                      setEditingView({
                        color: getSavedViewColor(view.color),
                        name: view.name,
                        view,
                      });
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon aria-hidden icon={Edit01Icon} />
                  </Button>
                </IconButtonTooltip>
              )}
              {view.ownerUserId !== null || canManage ? (
                <Button
                  disabled={
                    isRowActionPending("view", view.id, "update") ||
                    areStructuredMailSearchesEqual(
                      currentSearch,
                      getSearchFromStoredValue(view.search)
                    )
                  }
                  onClick={() => {
                    void runViewRowAction(
                      "view",
                      view.id,
                      "update",
                      async () =>
                        await updateViewMutation.mutateAsync({
                          definition: {
                            color: getSavedViewColor(view.color),
                            icon: view.icon,
                            name: view.name,
                            search: currentSearch,
                            sort: view.sort,
                          },
                          mailboxId,
                          viewId: view.id,
                        }),
                      "Could not update view."
                    );
                  }}
                  pending={isRowActionPending("view", view.id, "update")}
                  pendingLabel="Updating…"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Use current search
                </Button>
              ) : null}
              {view.ownerUserId === null ? (
                <Button
                  disabled={isRowActionPending("view", view.id, "duplicate")}
                  onClick={() => {
                    void runViewRowAction(
                      "view",
                      view.id,
                      "duplicate",
                      async () =>
                        await createViewMutation.mutateAsync({
                          definition: {
                            color: getSavedViewColor(view.color),
                            icon: view.icon,
                            name: `${view.name} copy`,
                            search: getSearchFromStoredValue(view.search),
                            sort: view.sort,
                          },
                          mailboxId,
                          shared: false,
                        }),
                      "Could not duplicate view."
                    );
                  }}
                  pending={isRowActionPending("view", view.id, "duplicate")}
                  pendingLabel="Copying…"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Duplicate
                </Button>
              ) : null}
              <IconButtonTooltip label={`Move ${view.name} up`}>
                <Button
                  aria-label={`Move ${view.name} up`}
                  disabled={scopeIndex <= 0 || reorderLocked}
                  onClick={() => {
                    if (scopeIndex <= 0) {
                      return;
                    }
                    const viewIds = sameScopeViews.map(
                      (candidate) => candidate.id
                    );
                    [viewIds[scopeIndex - 1], viewIds[scopeIndex]] = [
                      viewIds[scopeIndex],
                      viewIds[scopeIndex - 1],
                    ];
                    void runViewReorder(
                      viewScope,
                      view.id,
                      async () =>
                        await reorderViewsMutation.mutateAsync({
                          mailboxId,
                          viewIds,
                        }),
                      "Could not reorder views."
                    );
                  }}
                  pending={reorderPending}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <HugeiconsIcon aria-hidden icon={ArrowUp01Icon} />
                </Button>
              </IconButtonTooltip>
              <IconButtonTooltip label={`Move ${view.name} down`}>
                <Button
                  aria-label={`Move ${view.name} down`}
                  disabled={
                    scopeIndex === sameScopeViews.length - 1 || reorderLocked
                  }
                  onClick={() => {
                    if (
                      scopeIndex === -1 ||
                      scopeIndex === sameScopeViews.length - 1
                    ) {
                      return;
                    }
                    const viewIds = sameScopeViews.map(
                      (candidate) => candidate.id
                    );
                    [viewIds[scopeIndex], viewIds[scopeIndex + 1]] = [
                      viewIds[scopeIndex + 1],
                      viewIds[scopeIndex],
                    ];
                    void runViewReorder(
                      viewScope,
                      view.id,
                      async () =>
                        await reorderViewsMutation.mutateAsync({
                          mailboxId,
                          viewIds,
                        }),
                      "Could not reorder views."
                    );
                  }}
                  pending={reorderPending}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <HugeiconsIcon aria-hidden icon={ArrowDown01Icon} />
                </Button>
              </IconButtonTooltip>
              {(view.ownerUserId !== null || canManage) && (
                <IconButtonTooltip label={`Delete ${view.name}`}>
                  <Button
                    aria-label={`Delete ${view.name}`}
                    disabled={isRowActionPending("view", view.id, "delete")}
                    pending={isRowActionPending("view", view.id, "delete")}
                    onClick={() => {
                      void runViewRowAction(
                        "view",
                        view.id,
                        "delete",
                        async () =>
                          await deleteViewMutation.mutateAsync({
                            mailboxId,
                            viewId: view.id,
                          }),
                        "Could not delete view."
                      );
                    }}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon aria-hidden icon={Delete01Icon} />
                  </Button>
                </IconButtonTooltip>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const ManagedRuleActionEditor = (
  props: ManagedMailboxOrganizerContentProps
) => {
  const {
    ruleActionKind,
    ruleForwardIncludesAttachments,
    ruleForwardRecipients,
    ruleMoveDestination,
    ruleReadState,
    ruleStopsProcessing,
    setRuleActionKind,
    setRuleForwardIncludesAttachments,
    setRuleForwardRecipients,
    setRuleMoveDestination,
    setRuleReadState,
    setRuleStopsProcessing,
  } = props;

  return (
    <div className="squircle space-y-2 rounded-lg bg-secondary/40 p-3">
      <p className="text-xs font-medium text-muted-fg">Then</p>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {(
          [
            ["set-labels", "Apply labels"],
            ["set-read", "Read state"],
            ["move", "Move"],
            ["forward", "Forward"],
          ] as const
        ).map(([kind, label]) => (
          <Button
            aria-pressed={ruleActionKind === kind}
            className={cn({
              "bg-bg shadow-sm": ruleActionKind === kind,
            })}
            key={kind}
            onClick={() => {
              setRuleActionKind(kind);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {label}
          </Button>
        ))}
      </div>
      {ruleActionKind === "set-read" ? (
        <div className="grid grid-cols-2 gap-1">
          {[true, false].map((read) => (
            <Button
              aria-pressed={ruleReadState === read}
              className={cn({
                "bg-bg shadow-sm": ruleReadState === read,
              })}
              key={String(read)}
              onClick={() => {
                setRuleReadState(read);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              {read ? "Mark read" : "Mark unread"}
            </Button>
          ))}
        </div>
      ) : null}
      {ruleActionKind === "move" ? (
        <div className="grid grid-cols-2 gap-1">
          {(["archive", "inbox", "spam", "trash"] as const).map(
            (destination) => (
              <Button
                aria-pressed={ruleMoveDestination === destination}
                className={cn({
                  "bg-bg shadow-sm": ruleMoveDestination === destination,
                })}
                key={destination}
                onClick={() => {
                  setRuleMoveDestination(destination);
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {destination === "inbox"
                  ? "Move to Inbox"
                  : `Move to ${destination[0]?.toUpperCase()}${destination.slice(1)}`}
              </Button>
            )
          )}
        </div>
      ) : null}
      {ruleActionKind === "forward" ? (
        <div className="space-y-2">
          <Input
            aria-label="Forward recipients"
            onChange={(event) => {
              setRuleForwardRecipients(event.target.value);
            }}
            placeholder="Forward to email addresses"
            size="sm"
            value={ruleForwardRecipients}
          />
          <label
            className="flex items-center gap-2 text-sm"
            htmlFor="rule-forward-includes-attachments"
          >
            <Checkbox
              checked={ruleForwardIncludesAttachments}
              id="rule-forward-includes-attachments"
              onCheckedChange={setRuleForwardIncludesAttachments}
            >
              <CheckboxIndicator />
            </Checkbox>
            Include attachments
          </label>
        </div>
      ) : null}
      <label
        className="flex items-center gap-2 text-sm"
        htmlFor="rule-stop-processing"
      >
        <Checkbox
          checked={ruleStopsProcessing}
          id="rule-stop-processing"
          onCheckedChange={setRuleStopsProcessing}
        >
          <CheckboxIndicator />
        </Checkbox>
        Stop evaluating later rules after this match
      </label>
    </div>
  );
};

const ManagedRuleLabelsEditor = (
  props: ManagedMailboxOrganizerContentProps
) => {
  const {
    labelsData,
    ruleActionKind,
    selectedRuleLabelIdSet,
    setSelectedRuleLabelIds,
  } = props;

  return ruleActionKind === "set-labels" ? (
    <div className="squircle space-y-2 rounded-lg bg-secondary/40 p-3">
      <p className="text-xs font-medium text-muted-fg">Labels</p>
      {(labelsData ?? []).flatMap((label) =>
        label.type === "user"
          ? [
              <label
                className="flex items-center gap-2 text-sm"
                htmlFor={`rule-label-${label.id}`}
                key={label.id}
              >
                <Checkbox
                  checked={selectedRuleLabelIdSet.has(label.id)}
                  id={`rule-label-${label.id}`}
                  onCheckedChange={(checked) => {
                    setSelectedRuleLabelIds((current) =>
                      checked
                        ? [...current, label.id]
                        : current.filter((labelId) => labelId !== label.id)
                    );
                  }}
                >
                  <CheckboxIndicator />
                </Checkbox>
                <HugeiconsIcon
                  aria-hidden
                  className="size-3.5 text-muted-fg"
                  icon={Tag01Icon}
                />
                {label.name}
              </label>,
            ]
          : []
      )}
    </div>
  ) : null;
};

const ManagedRulePreviewActions = (
  props: ManagedMailboxOrganizerContentProps
) => {
  const {
    createRuleMutation,
    editingRuleId,
    editingRuleUpdatePending,
    preview,
    previewRule,
    previewRuleMutation,
    ruleActionKind,
    ruleForwardRecipients,
    ruleName,
    ruleQuery,
    saveRule,
    selectedRuleLabelIds,
  } = props;
  const validRuleInput = hasValidRuleInput({
    actionKind: ruleActionKind,
    forwardRecipients: ruleForwardRecipients,
    name: ruleName,
    query: ruleQuery,
    selectedLabelIds: selectedRuleLabelIds,
  });

  return (
    <>
      {preview ? (
        <p className="text-sm text-muted-fg">
          {preview.count} matching conversation
          {preview.count === 1 ? "" : "s"}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          disabled={!validRuleInput || previewRuleMutation.isPending}
          onClick={() => void previewRule()}
          pending={previewRuleMutation.isPending}
          pendingLabel="Previewing…"
          size="sm"
          type="button"
          variant="outline"
        >
          Preview
        </Button>
        <Button
          disabled={
            !validRuleInput ||
            createRuleMutation.isPending ||
            editingRuleUpdatePending
          }
          onClick={() => void saveRule()}
          pending={createRuleMutation.isPending || editingRuleUpdatePending}
          pendingLabel={
            editingRuleId !== null && editingRuleId !== ""
              ? "Updating…"
              : "Saving…"
          }
          size="sm"
          type="button"
        >
          {editingRuleId !== null && editingRuleId !== ""
            ? "Update rule"
            : "Save rule"}
        </Button>
      </div>
    </>
  );
};

const ManagedRuleBuilder = (props: ManagedMailboxOrganizerContentProps) => {
  const {
    ruleMatchMode,
    ruleName,
    ruleQuery,
    setRuleMatchMode,
    setRuleName,
    setRuleQueryDraft,
  } = props;

  return (
    <div className="mt-5 space-y-3">
      <Input
        aria-label="Rule name"
        onChange={(event) => {
          setRuleName(event.target.value);
        }}
        placeholder="Rule name"
        size="sm"
        value={ruleName}
      />
      <Input
        aria-label="Rule search"
        onChange={(event) => {
          setRuleQueryDraft(event.target.value);
        }}
        placeholder="from:vendor@example.com subject:invoice"
        size="sm"
        value={ruleQuery}
      />
      <div className="grid grid-cols-2 rounded-lg bg-muted/40 p-0.5">
        {(["all", "any"] as const).map((mode) => (
          <Button
            aria-pressed={ruleMatchMode === mode}
            className={cn({
              "bg-bg shadow-sm": ruleMatchMode === mode,
            })}
            key={mode}
            onClick={() => {
              setRuleMatchMode(mode);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            Match {mode}
          </Button>
        ))}
      </div>
      <ManagedRuleActionEditor {...props} />
      <ManagedRuleLabelsEditor {...props} />
      <ManagedRulePreviewActions {...props} />
    </div>
  );
};
type ManagedRule = RouterOutputs["mail"]["listManagedRules"][number];
type ManagedRuleRowProps = ManagedMailboxOrganizerContentProps & {
  index: number;
  rule: ManagedRule;
  rules: ManagedRule[];
};

const ManagedRuleRow = (props: ManagedRuleRowProps) => {
  const {
    backfillMutation,
    deleteRuleMutation,
    isRowActionPending,
    mailboxId,
    pendingReorders,
    reorderRulesMutation,
    ruleConditionGroupsRef,
    ruleEnabledRef,
    ruleActionsRef,
    runRuleReorder,
    runRuleRowAction,
    setActiveBackfillId,
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
    updateRuleMutation,
    index,
    rule,
    rules,
  } = props;

  return (
    <div className="flex items-center gap-3 py-2" key={rule.id}>
      <HugeiconsIcon
        aria-hidden
        className="size-4 text-muted-fg"
        icon={Tag01Icon}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{rule.name}</p>
        <p className="text-xs text-muted-fg">
          {rule.enabled ? "Enabled" : "Disabled"} /{" "}
          {getRuleActionLabel(
            getManagedMailboxRuleActions({
              actions: rule.actions,
              labelIds: rule.labelIds,
            })
          )}
        </p>
      </div>
      <Switch
        aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
        checked={rule.enabled}
        className="h-5 w-9 shrink-0 p-0.5"
        disabled={isRowActionPending("rule", rule.id, "update")}
        pending={isRowActionPending("rule", rule.id, "update")}
        onCheckedChange={(enabled) => {
          const conditionGroups = getRuleConditionGroups(rule.conditionGroups);
          if (
            hasInvalidRuleConditionGroups(rule.conditionGroups, conditionGroups)
          ) {
            toast.error("This rule has invalid condition groups.");
            return;
          }
          void runRuleRowAction(
            "rule",
            rule.id,
            "update",
            async () =>
              await updateRuleMutation.mutateAsync({
                definition: {
                  actions: getManagedMailboxRuleActions({
                    actions: rule.actions,
                    labelIds: rule.labelIds,
                  }),
                  conditionGroups,
                  enabled,
                  labelIds: rule.labelIds,
                  matchMode: rule.matchMode,
                  name: rule.name,
                  search: structuredMailSearchSchema.parse(rule.search),
                },
                mailboxId,
                ruleId: rule.id,
              }),
            "Could not update rule."
          );
        }}
      >
        <SwitchThumb className="size-4 data-checked:translate-x-4" />
      </Switch>
      <IconButtonTooltip label={`Edit ${rule.name}`}>
        <Button
          aria-label={`Edit ${rule.name}`}
          onClick={() => {
            const conditionGroups = getRuleConditionGroups(
              rule.conditionGroups
            );
            if (
              hasInvalidRuleConditionGroups(
                rule.conditionGroups,
                conditionGroups
              )
            ) {
              toast.error("This rule has invalid condition groups.");
              return;
            }
            setEditingRuleId(rule.id);
            setRuleName(rule.name);
            setRuleQueryDraft(
              serializeStructuredSearchState(
                structuredMailSearchSchema.parse(rule.search)
              )
            );
            setRuleMatchMode(rule.matchMode);
            ruleConditionGroupsRef.current = conditionGroups ?? null;
            const actions = getManagedMailboxRuleActions({
              actions: rule.actions,
              labelIds: rule.labelIds,
            });
            const action = getPrimaryRuleAction(actions);
            ruleActionsRef.current = actions;
            ruleEnabledRef.current = rule.enabled;
            setSelectedRuleLabelIds(
              action?.kind === "set-labels" ? action.addIds : []
            );
            setRuleForwardIncludesAttachments(false);
            if (action?.kind === "set-read") {
              setRuleActionKind("set-read");
              setRuleReadState(action.read);
            } else if (action?.kind === "move") {
              setRuleActionKind("move");
              setRuleMoveDestination(action.destination);
            } else if (action?.kind === "forward") {
              setRuleActionKind("forward");
              setRuleForwardRecipients(action.recipients.join(", "));
              setRuleForwardIncludesAttachments(action.includeAttachments);
            } else {
              setRuleActionKind("set-labels");
            }
            setRuleStopsProcessing(
              actions.some((candidate) => candidate.kind === "stop-processing")
            );
            setPreview(null);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={Edit01Icon} />
        </Button>
      </IconButtonTooltip>
      <IconButtonTooltip label={`Move ${rule.name} up`}>
        <Button
          aria-label={`Move ${rule.name} up`}
          disabled={index === 0 || pendingReorders.rules !== undefined}
          pending={pendingReorders.rules === rule.id}
          onClick={() => {
            const ruleIds = rules.map((candidate) => candidate.id);
            [ruleIds[index - 1], ruleIds[index]] = [
              ruleIds[index],
              ruleIds[index - 1],
            ];
            void runRuleReorder(
              rule.id,
              async () =>
                await reorderRulesMutation.mutateAsync({
                  mailboxId,
                  ruleIds,
                }),
              "Could not reorder rules."
            );
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={ArrowUp01Icon} />
        </Button>
      </IconButtonTooltip>
      <IconButtonTooltip label={`Move ${rule.name} down`}>
        <Button
          aria-label={`Move ${rule.name} down`}
          disabled={
            index === rules.length - 1 || pendingReorders.rules !== undefined
          }
          pending={pendingReorders.rules === rule.id}
          onClick={() => {
            const ruleIds = rules.map((candidate) => candidate.id);
            [ruleIds[index], ruleIds[index + 1]] = [
              ruleIds[index + 1],
              ruleIds[index],
            ];
            void runRuleReorder(
              rule.id,
              async () =>
                await reorderRulesMutation.mutateAsync({
                  mailboxId,
                  ruleIds,
                }),
              "Could not reorder rules."
            );
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={ArrowDown01Icon} />
        </Button>
      </IconButtonTooltip>
      <IconButtonTooltip label={`Apply ${rule.name} to existing mail`}>
        <Button
          aria-label={`Apply ${rule.name} to existing mail`}
          disabled={isRowActionPending("rule", rule.id, "backfill")}
          pending={isRowActionPending("rule", rule.id, "backfill")}
          pendingLabel="Running…"
          onClick={() => {
            void runRuleRowAction(
              "rule",
              rule.id,
              "backfill",
              async () =>
                await backfillMutation.mutateAsync({
                  mailboxId,
                  ruleId: rule.id,
                }),
              "Could not start the historical rule run.",
              (backfill) => {
                setActiveBackfillId(backfill.id);
                toast.success("Historical rule run started.");
              }
            );
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={ArrowRight01Icon} />
        </Button>
      </IconButtonTooltip>
      <IconButtonTooltip label={`Delete ${rule.name}`}>
        <Button
          aria-label={`Delete ${rule.name}`}
          disabled={isRowActionPending("rule", rule.id, "delete")}
          pending={isRowActionPending("rule", rule.id, "delete")}
          onClick={() => {
            void runRuleRowAction(
              "rule",
              rule.id,
              "delete",
              async () =>
                await deleteRuleMutation.mutateAsync({
                  mailboxId,
                  ruleId: rule.id,
                }),
              "Could not delete rule."
            );
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={Delete01Icon} />
        </Button>
      </IconButtonTooltip>
    </div>
  );
};

const ManagedRulesList = (props: ManagedMailboxOrganizerContentProps) => {
  const { rulesData } = props;

  return (
    <div className="mt-5 divide-y">
      {(rulesData ?? []).map((rule, index, rules) => (
        <ManagedRuleRow
          {...props}
          index={index}
          key={rule.id}
          rule={rule}
          rules={rules}
        />
      ))}
    </div>
  );
};

const ManagedRuleBackfill = (props: ManagedMailboxOrganizerContentProps) => {
  const { backfillData, cancelBackfill, cancelBackfillMutation } = props;

  return backfillData ? (
    <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Historical rule run</p>
          <p className="text-xs text-muted-fg">
            {backfillData.processedCount} processed {backfillData.matchedCount}{" "}
            matched
          </p>
        </div>
        {["pending", "running"].includes(backfillData.status) ? (
          <Button
            disabled={cancelBackfillMutation.isPending}
            pending={cancelBackfillMutation.isPending}
            pendingLabel="Cancelling…"
            onClick={() => {
              void cancelBackfill(backfillData.id);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        ) : (
          <span className="text-xs text-muted-fg capitalize">
            {backfillData.status}
          </span>
        )}
      </div>
    </div>
  ) : null;
};

const ManagedMailboxRulesPanel = (
  props: ManagedMailboxOrganizerContentProps
) => {
  const { canManage } = props;

  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight">Automatic rules</h2>
      <FullPageDialogDescription className="mt-1">
        Match new inbound mail with the same filters used by search, then apply
        a predictable action.
      </FullPageDialogDescription>
      {canManage ? (
        <>
          <ManagedRuleBuilder {...props} />
          <ManagedRulesList {...props} />
          <ManagedRuleBackfill {...props} />
        </>
      ) : (
        <p className="mt-5 text-sm text-muted-fg">
          Mailbox managers configure automatic rules.
        </p>
      )}
    </section>
  );
};
const ManagedMailboxOrganizerFullPageDialog = (
  props: ManagedMailboxOrganizerContentProps
) => {
  const { isOpen, setIsOpen } = props;

  return (
    <FullPageDialog onOpenChange={setIsOpen} open={isOpen}>
      <FullPageDialogContent>
        <FullPageDialogHeader>
          <IconButtonTooltip label="Close organizer">
            <FullPageDialogClose aria-label="Close organizer">
              <HugeiconsIcon aria-hidden icon={ArrowLeft02Icon} />
            </FullPageDialogClose>
          </IconButtonTooltip>
          <FullPageDialogTitle>Organize mailbox</FullPageDialogTitle>
        </FullPageDialogHeader>
        <FullPageDialogBody>
          <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-8 md:grid-cols-2">
            <ManagedMailboxSavedViewsPanel {...props} />
            <ManagedMailboxRulesPanel {...props} />
          </div>
        </FullPageDialogBody>
      </FullPageDialogContent>
    </FullPageDialog>
  );
};

const ManagedMailboxSavedViewEditDialog = (
  props: ManagedMailboxOrganizerContentProps
) => {
  const {
    editingView,
    editingViewUpdatePending,
    saveViewEdit,
    setEditingView,
  } = props;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setEditingView(null);
        }
      }}
      open={!!editingView}
    >
      <DialogContent className="w-[min(92vw,24rem)] border-0 bg-popover shadow-lg">
        <form
          action={() => {
            void saveViewEdit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit saved view</DialogTitle>
            <DialogDescription>
              Change its name and sidebar color.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-5 bg-secondary/25">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                className="border-0 bg-bg/70 shadow-none"
                disabled={editingViewUpdatePending}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setEditingView((current) =>
                    current ? { ...current, name } : current
                  );
                }}
                value={editingView?.name ?? ""}
              />
            </Field>
            <Field>
              <FieldLabel>Color</FieldLabel>
              <MailboxColorPicker
                label="Saved view color"
                onChange={(color) => {
                  setEditingView((current) =>
                    current ? { ...current, color } : current
                  );
                }}
                value={editingView?.color ?? "gray"}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton variant="ghost">Cancel</DialogCloseButton>
            <Button
              disabled={
                editingViewUpdatePending ||
                editingView === null ||
                editingView.name.trim() === ""
              }
              pending={editingViewUpdatePending}
              pendingLabel="Saving…"
              size="sm"
              type="submit"
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ManagedMailboxOrganizerContent = (
  props: ManagedMailboxOrganizerContentProps
) => (
  <>
    <ManagedMailboxOrganizerSidebar {...props} />
    <ManagedMailboxOrganizerFullPageDialog {...props} />
    <ManagedMailboxSavedViewEditDialog {...props} />
  </>
);

export const ManagedMailboxOrganizer = (
  props: ManagedMailboxOrganizerProps
) => {
  const controller = useManagedMailboxOrganizerController(props);
  return <ManagedMailboxOrganizerContent {...props} {...controller} />;
};
