"use client";

import {
  Add01Icon,
  AiMagicIcon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  Delete01Icon,
  FolderTransferIcon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { MailSubviewHeader } from "@quieter/app/features/mailbox/components/mail-subview-header";
import { AutoLabelEditor } from "@quieter/app/features/message-labels/components/auto-label-editor";
import { AutoLabelSwitch } from "@quieter/app/features/message-labels/components/auto-label-switch";
import { MailboxColorPicker } from "@quieter/app/features/message-labels/components/mailbox-color-picker";
import { getAutoLabelPrompt } from "@quieter/app/features/message-labels/domain/auto-label-prompt";
import {
  MAX_VISIBLE_SIDEBAR_LABELS,
  SIDEBAR_LABEL_VISIBILITY_EVENT,
  computeEffectiveHiddenLabelIds,
  createHiddenLabelState,
  readHiddenLabelIds,
  reduceHiddenLabelState,
  writeHiddenLabelIds,
} from "@quieter/app/features/message-labels/domain/sidebar-label-visibility";
import { getUserLabels } from "@quieter/app/features/message-search/state/message-list-search-state";
import {
  getDemoLabelAutomation,
  saveDemoLabelAutomation,
} from "@quieter/app/lib/demo-mail/label-automation";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  labelOrganizationQueryOptions,
  updateLabelOrganization,
} from "@quieter/app/lib/mail/label-organization-query";
import {
  getLabelsQueryKey,
  labelsQueryOptions,
} from "@quieter/app/lib/mail/labels-query";
import {
  getManagedLabelCountsQueryKey,
  managedLabelCountsQueryOptions,
} from "@quieter/app/lib/managed-mailbox-organization-query";
import { orpc } from "@quieter/app/lib/orpc";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import {
  applyLabelOrganizationAction,
  emptyLabelOrganization,
  mailboxLabelNamedColorSchema,
  orderLabelGroups,
  orderMailboxLabels,
} from "@quieter/mail/mailbox-organization";
import type {
  LabelOrganization,
  LabelOrganizationAction,
  MailboxLabel,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuContent,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { ChevronRightIcon, EyeIcon, EyeOffIcon } from "@quieter/ui/icons";
import { Input } from "@quieter/ui/input";
import { InputAddon, InputGroup } from "@quieter/ui/input-group";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import { WorkspaceHeader } from "@quieter/ui/workspace-section";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import {
  AnimatePresence,
  LazyMotion,
  domMax,
  m,
  useReducedMotion,
} from "motion/react";
import { Fragment, useEffect, useReducer, useState } from "react";
import type { ReactNode } from "react";

import { createLabelGroupTree } from "../domain/label-group-tree";
import type { LabelGroup } from "../domain/label-group-tree";
import { useDeleteMailboxLabel } from "./delete-mailbox-label-dialog";
import {
  LabelDragProvider,
  LabelDragRow,
  LabelDropTarget,
  LabelGroupDragRow,
} from "./label-drag";
import { getLabelUpdates } from "./label-update-mutation";
import { LabelsInlineEditor } from "./labels-inline-editor";
import { MailboxLabelSwatch } from "./mailbox-label-swatch";

type LabelsWorkspacePanelProps = {
  canManage: boolean;
  mailboxId: string | null;
  mailboxProvider: "gmail" | "managed";
  onClose: () => void;
  onOpenSidebar: () => void;
};

type LabelEditor =
  | {
      mode: "create";
      kind: "label" | "group";
      groupId: string | null;
      id: string;
    }
  | { mode: "rename"; kind: "label" | "group"; id: string };

type ColorEdit = {
  kind: "label" | "group";
  id: string;
  value: MailboxLabelColor;
};

const rowClassName =
  "relative flex min-h-9 w-full items-center gap-2 rounded-lg px-2";
// The 24px drag handle overflows the narrower gutter into the row padding so
// the group caret can sit closer to it without the two targets overlapping.
const gutterCellClassName = "flex w-4 shrink-0 justify-center";
const caretCellClassName =
  "me-0.5 flex w-3 shrink-0 items-center justify-center";
const nameCellClassName =
  "flex min-w-0 flex-1 items-center gap-1.5 self-stretch @sm:w-1/3 @sm:flex-none";
const promptCellClassName = "hidden min-w-0 flex-1 items-center @sm:flex";
const switchCellClassName =
  "flex w-16 shrink-0 justify-center whitespace-nowrap";
const menuCellClassName = "flex w-6 shrink-0 justify-center";

const isNonemptyMailboxId = (
  mailboxId: string | null | undefined
): mailboxId is string => (mailboxId?.trim() ?? "") !== "";

const renderDelete = ({
  name,
  kind,
  pending,
  onCancel,
  onDelete,
}: {
  name: string;
  kind: "label" | "group";
  pending: boolean;
  onCancel: () => void;
  onDelete: () => void;
}) => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-1.5 ps-8 pe-2">
    <Text as="p" className="min-w-0 flex-1" size="sm" tone="muted">
      Delete <span className="text-fg">{name}</span>?{" "}
      {kind === "group"
        ? "Its labels move out of the group."
        : "It will be removed from conversations and automatic rules."}
    </Text>
    <ActionFooter className="w-40 max-w-full">
      <Button
        disabled={pending}
        onClick={onCancel}
        size="xs"
        variant="secondary"
      >
        Cancel
      </Button>
      <Button
        onClick={onDelete}
        pending={pending}
        size="xs"
        variant="destructive"
      >
        Delete
      </Button>
    </ActionFooter>
  </div>
);

const renderTreeGuide = (last: boolean) => (
  <span aria-hidden="true" className="relative w-5 shrink-0 self-stretch">
    {last ? null : (
      <span className="absolute inset-y-0 start-1/2 border-s border-border" />
    )}
    <span className="absolute start-1/2 top-0 h-1/2 w-2 rounded-es-md border-s border-b border-border" />
  </span>
);

export const LabelsWorkspacePanel = ({
  canManage,
  mailboxId,
  mailboxProvider,
  onClose,
  onOpenSidebar,
}: LabelsWorkspacePanelProps) => {
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const [editor, setEditor] = useState<LabelEditor | null>(null);
  const [colorEdit, setColorEdit] = useState<ColorEdit | null>(null);
  const [labelSearch, setLabelSearch] = useState("");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [deletingGroup, setDeletingGroup] = useState<LabelGroup | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<MailboxLabel | null>(null);
  const deleteLabel = useDeleteMailboxLabel({
    mailboxId: mailboxId ?? "",
    mailboxProvider,
    onDeleted: () => {
      setDeletingLabel(null);
    },
  });
  const [automationLabelId, setAutomationLabelId] = useState<string | null>(
    null
  );
  const [hiddenLabelState, updateHiddenLabelState] = useReducer(
    reduceHiddenLabelState,
    mailboxId,
    createHiddenLabelState
  );
  const {
    data: labels,
    isError: areLabelsError,
    isPaused: areLabelsPaused,
    isPending: areLabelsPending,
    refetch: refetchLabels,
  } = useQuery(
    labelsQueryOptions(mailboxId ?? "", isNonemptyMailboxId(mailboxId))
  );
  const labelsUnavailable = areLabelsError && labels === undefined;

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isNonemptyMailboxId(mailboxId)) {
        return;
      }
      updateHiddenLabelState({
        mailboxId,
        updater: () => readHiddenLabelIds(mailboxId),
      });
    };
    window.addEventListener(
      SIDEBAR_LABEL_VISIBILITY_EVENT,
      handleVisibilityChange
    );
    return () => {
      window.removeEventListener(
        SIDEBAR_LABEL_VISIBILITY_EVENT,
        handleVisibilityChange
      );
    };
  }, [mailboxId]);

  const { data: managedLabelCounts = [] } = useQuery(
    managedLabelCountsQueryOptions(
      mailboxId ?? "",
      mailboxProvider === "managed" && isNonemptyMailboxId(mailboxId)
    )
  );
  const managedLabelCountById = new Map(
    managedLabelCounts.map((record) => [record.labelId, record.count])
  );

  const labelUpdates = getLabelUpdates({
    mailboxId: mailboxId ?? "",
    mailboxProvider,
    queryClient,
  });
  const labelUpdateState = useSelector(labelUpdates.state);
  const { data: organizationData, isError: isOrganizationError } = useQuery(
    labelOrganizationQueryOptions(
      mailboxId ?? "",
      isNonemptyMailboxId(mailboxId)
    )
  );
  const organization = organizationData ?? emptyLabelOrganization;

  const sidebarLabels = getUserLabels(
    labelUpdates.project(labels ?? [], labelUpdateState)
  );
  const userLabels = orderMailboxLabels(sidebarLabels, organization.labelOrder);
  const hiddenLabelIds =
    hiddenLabelState.mailboxId === mailboxId
      ? hiddenLabelState.value
      : readHiddenLabelIds(mailboxId);
  const effectiveHiddenLabelIds = computeEffectiveHiddenLabelIds(
    mailboxProvider,
    sidebarLabels,
    hiddenLabelIds
  );
  const visibleLabelCount = sidebarLabels.filter(
    (label) => !effectiveHiddenLabelIds.has(label.id)
  ).length;

  const createLabelMutation = useMutation(
    orpc.mail.createLabel.mutationOptions()
  );
  const updateLabelMutation = useMutation(labelUpdates.options);
  const updateLabelDetailsMutation = useMutation(
    orpc.mail.updateLabelDetails.mutationOptions()
  );
  const isSavingLabel =
    labelUpdateState.pending.length > 0 || updateLabelDetailsMutation.isPending;
  const areLabelActionsDisabled = !canManage || isSavingLabel;

  const defaultGroupColor =
    mailboxLabelNamedColorSchema.options.find(
      (color) =>
        color !== "gray" &&
        !organization.groups.some((group) => group.color === color)
    ) ?? "blue";
  const organizationMutationKey = labelOrganizationQueryOptions(
    mailboxId ?? ""
  ).queryKey;
  const organizationMutation = useMutation<
    LabelOrganization,
    Error,
    { action: LabelOrganizationAction; mailboxId: string },
    {
      optimistic: LabelOrganization | undefined;
      previous: LabelOrganization;
    } | null
  >({
    mutationFn: async ({ action, mailboxId: changedMailboxId }) =>
      await updateLabelOrganization(changedMailboxId, action),
    mutationKey: organizationMutationKey,
    onError: (_error, input, context) => {
      const { queryKey } = labelOrganizationQueryOptions(input.mailboxId);
      if (
        context !== null &&
        context !== undefined &&
        queryClient.getQueryData(queryKey) === context.optimistic
      ) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      void queryClient.invalidateQueries({ queryKey });
    },
    onMutate: async ({ action, mailboxId: changedMailboxId }) => {
      if (action.kind !== "move-label" && action.kind !== "move-group") {
        return null;
      }
      const { queryKey } = labelOrganizationQueryOptions(changedMailboxId);
      const cancellation = queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<LabelOrganization>(queryKey);
      if (!previous) {
        await cancellation;
        return null;
      }
      const next = applyLabelOrganizationAction(
        previous,
        action,
        crypto.randomUUID()
      );
      if (typeof next === "string") {
        await cancellation;
        return null;
      }
      const optimistic = queryClient.setQueryData(queryKey, next);
      await cancellation;
      return { optimistic, previous };
    },
    onSuccess: (updated, input) => {
      queryClient.setQueryData(
        labelOrganizationQueryOptions(input.mailboxId).queryKey,
        updated
      );
    },
    scope: { id: JSON.stringify(organizationMutationKey) },
  });
  const isChangingOrganization =
    useIsMutating({ exact: true, mutationKey: organizationMutationKey }) > 0;
  const areGroupActionsDisabled =
    areLabelActionsDisabled ||
    organizationData === undefined ||
    isChangingOrganization;

  const labelGroupTree = createLabelGroupTree(organization);
  const groups = orderLabelGroups(organization);
  const labelsByGroupId = new Map<string | null, MailboxLabel[]>();
  for (const label of userLabels) {
    const groupId = labelGroupTree.getLabelGroupId(label.id);
    labelsByGroupId.set(groupId, [
      ...(labelsByGroupId.get(groupId) ?? []),
      label,
    ]);
  }

  const setMailboxHiddenLabelIds = (
    updater: (current: Set<string>) => Set<string>
  ) => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    writeHiddenLabelIds(mailboxId, updater(readHiddenLabelIds(mailboxId)));
  };

  const invalidateLabels = async () => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getLabelsQueryKey(mailboxId) }),
      ...(mailboxProvider === "managed"
        ? [
            queryClient.invalidateQueries({
              queryKey: getManagedLabelCountsQueryKey(mailboxId),
            }),
          ]
        : []),
    ]);
  };

  const runOrganizationAction = async (
    action: LabelOrganizationAction,
    fallback: string
  ): Promise<boolean> => {
    if (
      !isNonemptyMailboxId(mailboxId) ||
      !canManage ||
      queryClient.isMutating({
        exact: true,
        mutationKey: organizationMutationKey,
      }) > 0
    ) {
      return false;
    }
    try {
      await organizationMutation.mutateAsync({ action, mailboxId });
      return true;
    } catch (error) {
      toastError(error, { boundary: "labels-panel", fallback });
      return false;
    }
  };

  const expandGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      next.delete(groupId);
      return next;
    });
  };

  const openCreator = (
    kind: "label" | "group",
    groupId: string | null = null
  ) => {
    setLabelSearch("");
    if (groupId !== null) {
      expandGroup(groupId);
    }
    setEditor({ groupId, id: crypto.randomUUID(), kind, mode: "create" });
  };

  const createLabel = async (
    { name, color }: { name: string; color: MailboxLabelColor },
    groupId: string | null
  ) => {
    if (!isNonemptyMailboxId(mailboxId) || !canManage) {
      return;
    }
    if (
      userLabels.some(
        (label) => label.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      toast.error("A label with this name already exists.");
      return;
    }

    let labelId: string;
    try {
      if (isSandboxMailboxId(mailboxId)) {
        const current = getDemoLabelAutomation(mailboxId);
        const demoLabel: MailboxLabel = {
          autoLabel: null,
          color,
          description: null,
          id: `demo:label:${crypto.randomUUID()}`,
          inclusionCriteria: null,
          name,
          position: userLabels.length,
          provider: mailboxProvider,
          type: "user",
          visible: true,
        };
        saveDemoLabelAutomation(mailboxId, {
          ...current,
          createdLabels: [...current.createdLabels, demoLabel],
        });
        labelId = demoLabel.id;
      } else {
        const label = await createLabelMutation.mutateAsync({
          color,
          mailboxId,
          name,
        });
        labelId = label.id;
      }
      if (visibleLabelCount >= MAX_VISIBLE_SIDEBAR_LABELS) {
        setMailboxHiddenLabelIds((current) => {
          current.add(labelId);
          return current;
        });
      }
      await invalidateLabels();
    } catch (error) {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not create label.",
      });
      return;
    }
    if (groupId !== null) {
      await runOrganizationAction(
        {
          groupId,
          kind: "move-label",
          labelId,
          labelOrder: [...userLabels.map(({ id }) => id), labelId],
        },
        "Label created, but it could not be added to the group. Use Move to group to try again."
      );
    }
    setEditor((current) => (current === editor ? null : current));
  };

  const saveGroup = async (
    draft: Pick<LabelGroup, "name" | "color">,
    groupId?: string
  ) =>
    await runOrganizationAction(
      groupId === undefined
        ? { ...draft, kind: "create-group", parentId: null }
        : { ...draft, groupId, kind: "update-group", parentId: null },
      groupId === undefined
        ? "Could not create group."
        : "Could not update group."
    );

  const deleteGroup = async (group: LabelGroup) => {
    if (
      await runOrganizationAction(
        { groupId: group.id, kind: "delete-group" },
        "Could not delete group."
      )
    ) {
      setDeletingGroup(null);
    }
  };

  const saveLabelAutomation = async (
    label: MailboxLabel,
    autoLabel: AutoLabelSettings
  ): Promise<boolean> => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return false;
    }
    try {
      if (isSandboxMailboxId(mailboxId)) {
        const current = getDemoLabelAutomation(mailboxId);
        saveDemoLabelAutomation(mailboxId, {
          ...current,
          labels: { ...current.labels, [label.id]: autoLabel },
        });
      } else {
        await updateLabelDetailsMutation.mutateAsync({
          autoLabel,
          description: label.description,
          inclusionCriteria: label.inclusionCriteria,
          labelId: label.id,
          mailboxId,
        });
      }
      await invalidateLabels();
      return true;
    } catch (error) {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not update auto-labeling. Please try again.",
      });
      return false;
    }
  };

  const saveLabelName = (label: MailboxLabel, name: string) => {
    if (label.name !== name) {
      updateLabelMutation.mutate({
        change: { kind: "name", name },
        labelId: label.id,
      });
    }
    setEditor(null);
  };

  const toggleSidebarVisibility = (label: MailboxLabel) => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    if (mailboxProvider === "managed") {
      updateLabelMutation.mutate({
        change: {
          kind: "visibility",
          visible: effectiveHiddenLabelIds.has(label.id),
        },
        labelId: label.id,
      });
      return;
    }

    setMailboxHiddenLabelIds((current) => {
      const isShown = !effectiveHiddenLabelIds.has(label.id);
      if (isShown) {
        current.add(label.id);
      } else {
        if (visibleLabelCount >= MAX_VISIBLE_SIDEBAR_LABELS) {
          toast.error("Hide one label before showing another.");
          return current;
        }

        current.delete(label.id);
      }
      return current;
    });
  };

  const moveLabel = async (
    labelId: string,
    groupId: string | null,
    target?: { id: string; edge: "before" | "after" }
  ) => {
    if (areGroupActionsDisabled || target?.id === labelId) {
      return;
    }
    const destination = (labelsByGroupId.get(groupId) ?? []).filter(
      (label) => label.id !== labelId
    );
    const targetIndex = destination.findIndex(
      (label) => label.id === target?.id
    );
    if (target !== undefined && targetIndex === -1) {
      return;
    }
    const beforeLabelId =
      targetIndex === -1
        ? null
        : (destination[targetIndex + (target?.edge === "after" ? 1 : 0)]?.id ??
          null);
    const currentGroupId = labelGroupTree.getLabelGroupId(labelId);
    const currentLabels = labelsByGroupId.get(currentGroupId) ?? [];
    const currentIndex = currentLabels.findIndex(
      (label) => label.id === labelId
    );
    if (
      currentGroupId === groupId &&
      currentIndex !== -1 &&
      (currentLabels[currentIndex + 1]?.id ?? null) === beforeLabelId
    ) {
      return;
    }
    const saved = await runOrganizationAction(
      {
        beforeLabelId,
        groupId,
        kind: "move-label",
        labelId,
        labelOrder: userLabels.map(({ id }) => id),
      },
      "Could not move label."
    );
    if (saved && groupId !== null) {
      expandGroup(groupId);
    }
  };

  const moveGroup = async (
    groupId: string,
    target: { id: string; edge: "before" | "after" }
  ) => {
    if (areGroupActionsDisabled || target.id === groupId) {
      return;
    }
    const destination = groups.filter((group) => group.id !== groupId);
    const targetIndex = destination.findIndex(
      (group) => group.id === target.id
    );
    if (targetIndex === -1) {
      return;
    }
    const beforeGroupId =
      destination[targetIndex + (target.edge === "after" ? 1 : 0)]?.id ?? null;
    const currentIndex = groups.findIndex((group) => group.id === groupId);
    if (
      currentIndex === -1 ||
      (groups[currentIndex + 1]?.id ?? null) === beforeGroupId
    ) {
      return;
    }
    await runOrganizationAction(
      { beforeGroupId, groupId, kind: "move-group" },
      "Could not move group."
    );
  };

  const toggleGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (!next.delete(groupId)) {
        next.add(groupId);
      }
      return next;
    });
  };

  const query = labelSearch.trim().toLocaleLowerCase();
  const matches = (label: MailboxLabel) =>
    label.name.toLocaleLowerCase().includes(query);
  const groupMatches = (group: LabelGroup) =>
    group.name.toLocaleLowerCase().includes(query);
  const matchesGroupMember = (groupId: string | null) => {
    const group = groups.find(({ id }) => id === groupId);
    return (label: MailboxLabel) =>
      matches(label) || (group !== undefined && groupMatches(group));
  };
  const ungrouped = (labelsByGroupId.get(null) ?? []).filter(matches);
  const dragDisabled = areGroupActionsDisabled || query !== "";

  const renderPresence = (
    key: string,
    show: boolean,
    content: ReactNode,
    as: "div" | "li" = "div"
  ) => {
    const Presence = as === "li" ? m.li : m.div;
    return (
      <AnimatePresence initial={false}>
        {show ? (
          <Presence
            animate="open"
            className="overflow-clip"
            exit="closed"
            initial="closed"
            key={key}
            transition={{
              duration: reducedMotion === true ? 0 : 0.16,
              ease: [0.23, 1, 0.32, 1],
            }}
            variants={{
              closed: { height: 0, opacity: 0 },
              open: { height: "auto", opacity: 1 },
            }}
          >
            {content}
          </Presence>
        ) : null}
      </AnimatePresence>
    );
  };

  const renderTrailingSpacers = () => (
    <>
      <span aria-hidden="true" className="hidden min-w-0 flex-1 @sm:block" />
      <span aria-hidden="true" className={switchCellClassName} />
      <span aria-hidden="true" className={menuCellClassName} />
    </>
  );

  const renderLabelRow = (label: MailboxLabel) => {
    const isShown = !effectiveHiddenLabelIds.has(label.id);
    const editingColor =
      colorEdit?.kind === "label" && colorEdit.id === label.id
        ? colorEdit
        : null;
    const groupId = labelGroupTree.getLabelGroupId(label.id);
    const siblings = labelsByGroupId.get(groupId) ?? [];
    const index = siblings.findIndex(({ id }) => id === label.id);
    const previous = index > 0 ? siblings.at(index - 1) : undefined;
    const next = siblings.at(index + 1);
    const visibleSiblings = siblings.filter(matchesGroupMember(groupId));
    const isLastVisible = visibleSiblings.at(-1)?.id === label.id;
    const renaming =
      editor?.mode === "rename" &&
      editor.kind === "label" &&
      editor.id === label.id;
    const editingPrompt = automationLabelId === label.id;
    const prompt = getAutoLabelPrompt(label);
    const autoLabelEnabled = label.autoLabel?.enabled !== false;
    return (
      <Fragment key={label.id}>
        <LabelDragRow
          className={cn(rowClassName, {
            "flex-wrap @sm:flex-nowrap": editingPrompt,
          })}
          color={label.color}
          disabled={dragDisabled}
          groupId={groupId}
          labelId={label.id}
          name={label.name}
        >
          <div className={nameCellClassName}>
            <span aria-hidden="true" className={caretCellClassName} />
            {groupId === null ? null : renderTreeGuide(isLastVisible)}
            <MailboxColorPicker
              className="flex shrink-0"
              disabled={areLabelActionsDisabled && editingColor === null}
              label={`Edit color for ${label.name}`}
              onChange={(value) => {
                setColorEdit({ id: label.id, kind: "label", value });
              }}
              onOpenChange={(open) => {
                if (open) {
                  setColorEdit({
                    id: label.id,
                    kind: "label",
                    value: label.color ?? "gray",
                  });
                } else if (editingColor !== null) {
                  setColorEdit(null);
                  if (editingColor.value !== (label.color ?? "gray")) {
                    updateLabelMutation.mutate({
                      change: { color: editingColor.value, kind: "color" },
                      labelId: label.id,
                    });
                  }
                }
              }}
              open={editingColor !== null}
              trigger="swatch"
              value={editingColor?.value ?? label.color ?? "gray"}
            />
            {renaming ? (
              <LabelsInlineEditor
                initialColor={label.color ?? "gray"}
                initialName={label.name}
                kind="label"
                mode="rename"
                onCancel={() => {
                  setEditor(null);
                }}
                onSubmit={({ name }) => {
                  saveLabelName(label, name);
                }}
              />
            ) : (
              <Button
                aria-label={`Rename ${label.name}`}
                className="flex-1"
                disabled={areLabelActionsDisabled}
                onClick={() => {
                  setEditor({ id: label.id, kind: "label", mode: "rename" });
                }}
                size="inline-field"
                variant="inline-edit"
              >
                <span className="truncate">{label.name}</span>
                {mailboxProvider === "managed" ? (
                  <span className="shrink-0 text-caption text-muted-fg tabular-nums">
                    {managedLabelCountById.get(label.id) ?? 0}
                  </span>
                ) : null}
              </Button>
            )}
          </div>
          <div
            className={cn({
              "order-last flex w-full min-w-0 ps-6 pb-2 @sm:order-none @sm:w-auto @sm:flex-1 @sm:py-0.5 @sm:ps-0":
                editingPrompt,
              [promptCellClassName]: !editingPrompt,
            })}
          >
            {editingPrompt ? (
              <AutoLabelEditor
                key={`${mailboxId}:${label.id}`}
                label={label}
                onCancel={() => {
                  setAutomationLabelId(null);
                }}
                onSave={async (settings) => {
                  const saved = await saveLabelAutomation(label, settings);
                  if (saved) {
                    setAutomationLabelId((current) =>
                      current === label.id ? null : current
                    );
                  }
                  return saved;
                }}
              />
            ) : (
              <Button
                aria-label={`Edit auto-label prompt for ${label.name}`}
                className="w-full"
                disabled={areLabelActionsDisabled}
                onClick={() => {
                  setAutomationLabelId(label.id);
                }}
                size="inline-field"
                variant="inline-edit"
              >
                <Text as="span" size="sm" tone="muted" truncate>
                  {prompt === "" ? "Add prompt…" : prompt}
                </Text>
              </Button>
            )}
          </div>
          <div className={switchCellClassName}>
            <IconButtonTooltip
              label={`${autoLabelEnabled ? "Disable" : "Enable"} auto-label for ${label.name}`}
            >
              <Switch
                aria-label={`Auto-label ${label.name}`}
                checked={autoLabelEnabled}
                disabled={areLabelActionsDisabled}
                onCheckedChange={(enabled) => {
                  void saveLabelAutomation(label, {
                    ...(label.autoLabel ?? {
                      domains: [],
                      keywordScope: "anywhere",
                      keywords: [],
                      matchMode: "all",
                      prompt: label.inclusionCriteria ?? "",
                      recipients: [],
                      senders: [],
                    }),
                    enabled,
                  });
                }}
                size="xs"
              >
                <SwitchThumb />
              </Switch>
            </IconButtonTooltip>
          </div>
          <div className={menuCellClassName}>
            <DropdownMenu>
              <IconButtonTooltip label={`Options for ${label.name}`}>
                <DropdownMenuTrigger
                  aria-label={`Options for ${label.name}`}
                  disabled={areLabelActionsDisabled}
                  render={<Button size="icon-xs" variant="ghost" />}
                >
                  <Icon aria-hidden icon={MoreHorizontalIcon} />
                </DropdownMenuTrigger>
              </IconButtonTooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setEditor({ id: label.id, kind: "label", mode: "rename" });
                  }}
                >
                  <Icon aria-hidden icon={PencilEdit02Icon} />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setAutomationLabelId(label.id);
                  }}
                >
                  <Icon aria-hidden icon={AiMagicIcon} />
                  Edit prompt
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    toggleSidebarVisibility(label);
                  }}
                >
                  {isShown ? (
                    <EyeOffIcon aria-hidden className="size-4" />
                  ) : (
                    <EyeIcon aria-hidden className="size-4" />
                  )}
                  {isShown ? "Hide from sidebar" : "Show in sidebar"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={areGroupActionsDisabled || previous === undefined}
                  onSelect={() => {
                    if (previous !== undefined) {
                      void moveLabel(label.id, groupId, {
                        edge: "before",
                        id: previous.id,
                      });
                    }
                  }}
                >
                  <Icon aria-hidden icon={ArrowUp02Icon} />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={areGroupActionsDisabled || next === undefined}
                  onSelect={() => {
                    if (next !== undefined) {
                      void moveLabel(label.id, groupId, {
                        edge: "after",
                        id: next.id,
                      });
                    }
                  }}
                >
                  <Icon aria-hidden icon={ArrowDown02Icon} />
                  Move down
                </DropdownMenuItem>
                {groups.length > 0 ? (
                  <DropdownMenuSubmenu>
                    <DropdownMenuSubmenuTrigger
                      disabled={areGroupActionsDisabled}
                    >
                      <Icon aria-hidden icon={FolderTransferIcon} />
                      Move to group
                    </DropdownMenuSubmenuTrigger>
                    <DropdownMenuSubmenuContent>
                      {[
                        { color: null, id: null, name: "No group" },
                        ...groups,
                      ].map((option) => (
                        <DropdownMenuCheckboxItem
                          checked={groupId === option.id}
                          closeOnSelect
                          disabled={areGroupActionsDisabled}
                          key={option.id ?? "none"}
                          onCheckedChange={() => {
                            if (groupId !== option.id) {
                              void moveLabel(label.id, option.id);
                            }
                          }}
                        >
                          {option.id === null ? null : (
                            <MailboxLabelSwatch
                              color={option.color}
                              kind="group"
                            />
                          )}
                          <span className="min-w-0 truncate">
                            {option.name}
                          </span>
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuSubmenuContent>
                  </DropdownMenuSubmenu>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setDeletingLabel(label);
                  }}
                  tone="destructive"
                >
                  <Icon aria-hidden icon={Delete01Icon} />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </LabelDragRow>
        {renderPresence(
          `delete:${label.id}`,
          deletingLabel?.id === label.id,
          renderDelete({
            kind: "label",
            name: label.name,
            onCancel: () => {
              setDeletingLabel(null);
            },
            onDelete: () => {
              deleteLabel.mutate(label.id);
            },
            pending: deleteLabel.isPending,
          }),
          "li"
        )}
      </Fragment>
    );
  };

  const renderCreator = (groupId: string | null, hasChildren: boolean) =>
    renderPresence(
      "create",
      editor?.mode === "create" && editor.groupId === groupId,
      <div className={cn(rowClassName, "bg-section")}>
        <span aria-hidden="true" className={gutterCellClassName} />
        <div className={nameCellClassName}>
          <span aria-hidden="true" className={caretCellClassName} />
          {groupId === null ? null : renderTreeGuide(!hasChildren)}
          {editor?.mode === "create" ? (
            <LabelsInlineEditor
              initialColor={
                editor.kind === "group" ? defaultGroupColor : "gray"
              }
              initialName=""
              key={editor.id}
              kind={editor.kind}
              mode="create"
              onCancel={() => {
                setEditor((current) => (current === editor ? null : current));
              }}
              onSubmit={async (draft) => {
                if (editor.kind === "group") {
                  if (await saveGroup(draft)) {
                    setEditor((current) =>
                      current === editor ? null : current
                    );
                  }
                } else {
                  await createLabel(draft, groupId);
                }
              }}
            />
          ) : null}
        </div>
        {renderTrailingSpacers()}
      </div>
    );

  const renderGroup = (group: LabelGroup) => {
    const children = (labelsByGroupId.get(group.id) ?? []).filter(
      matchesGroupMember(group.id)
    );
    if (children.length === 0 && !groupMatches(group)) {
      return null;
    }
    const labelCount = labelsByGroupId.get(group.id)?.length ?? 0;
    const pendingAction = organizationMutation.isPending
      ? organizationMutation.variables?.action
      : undefined;
    const expanded =
      query !== "" ||
      !collapsedGroupIds.has(group.id) ||
      (pendingAction?.kind === "move-label" &&
        pendingAction.groupId === group.id);
    const [firstLabel] = children;
    const groupIndex = groups.findIndex((entry) => entry.id === group.id);
    const previousGroup = groups[groupIndex - 1];
    const nextGroup = groups[groupIndex + 1];
    const editingColor =
      colorEdit?.kind === "group" && colorEdit.id === group.id
        ? colorEdit
        : null;
    const renaming =
      editor?.mode === "rename" &&
      editor.kind === "group" &&
      editor.id === group.id;
    return (
      <LabelGroupDragRow
        color={group.color}
        disabled={dragDisabled}
        groupId={group.id}
        key={group.id}
        name={group.name}
      >
        {({ handle, headerRef, isDragSource }) => {
          const showChildren = expanded && !isDragSource;
          return (
            <>
              <div
                className={cn("rounded-lg", {
                  "bg-section shadow-sm": isDragSource,
                })}
                ref={headerRef}
              >
                <LabelDropTarget
                  className={rowClassName}
                  disabled={dragDisabled}
                  groupId={group.id}
                  target={
                    firstLabel === undefined
                      ? undefined
                      : { edge: "before", id: firstLabel.id }
                  }
                >
                  <div className={gutterCellClassName}>{handle}</div>
                  <div className={nameCellClassName}>
                    <div className={caretCellClassName}>
                      <IconButtonTooltip
                        label={showChildren ? "Collapse group" : "Expand group"}
                      >
                        <Button
                          aria-expanded={showChildren}
                          aria-label={`${showChildren ? "Collapse" : "Expand"} ${group.name}`}
                          disabled={query !== "" || isDragSource}
                          onClick={() => {
                            toggleGroup(group.id);
                          }}
                          size="icon-2xs"
                          className="shrink-0"
                          variant="ghost"
                        >
                          <span
                            className={cn(
                              "flex transition-transform duration-150 ease-out motion-reduce:transition-none",
                              { "rotate-90": showChildren }
                            )}
                          >
                            <ChevronRightIcon viewBox="-4 -4 24 24" />
                          </span>
                        </Button>
                      </IconButtonTooltip>
                    </div>
                    <MailboxColorPicker
                      className="flex shrink-0"
                      disabled={
                        areGroupActionsDisabled && editingColor === null
                      }
                      label={`Edit color for ${group.name}`}
                      onChange={(value) => {
                        setColorEdit({ id: group.id, kind: "group", value });
                      }}
                      onOpenChange={(open) => {
                        if (open) {
                          setColorEdit({
                            id: group.id,
                            kind: "group",
                            value: group.color,
                          });
                        } else if (editingColor !== null) {
                          setColorEdit(null);
                          if (editingColor.value !== group.color) {
                            void saveGroup(
                              { color: editingColor.value, name: group.name },
                              group.id
                            );
                          }
                        }
                      }}
                      open={editingColor !== null}
                      swatchShape="circle"
                      trigger="swatch"
                      value={editingColor?.value ?? group.color}
                    />
                    {renaming ? (
                      <LabelsInlineEditor
                        initialColor={group.color}
                        initialName={group.name}
                        kind="group"
                        mode="rename"
                        onCancel={() => {
                          setEditor(null);
                        }}
                        onSubmit={async (draft) => {
                          if (await saveGroup(draft, group.id)) {
                            setEditor((current) =>
                              current === editor ? null : current
                            );
                          }
                        }}
                      />
                    ) : (
                      <Button
                        aria-description={`${labelCount} ${labelCount === 1 ? "label" : "labels"}`}
                        aria-label={`Rename ${group.name}`}
                        className="flex-1"
                        disabled={areGroupActionsDisabled}
                        onClick={() => {
                          setEditor({
                            id: group.id,
                            kind: "group",
                            mode: "rename",
                          });
                        }}
                        size="inline-field"
                        variant="inline-edit"
                      >
                        <span className="truncate">{group.name}</span>
                        <span className="shrink-0 text-caption text-muted-fg tabular-nums">
                          {labelCount}
                        </span>
                      </Button>
                    )}
                  </div>
                  <span
                    aria-hidden="true"
                    className="hidden min-w-0 flex-1 @sm:block"
                  />
                  <span aria-hidden="true" className={switchCellClassName} />
                  <div className={menuCellClassName}>
                    <DropdownMenu>
                      <IconButtonTooltip label={`Options for ${group.name}`}>
                        <DropdownMenuTrigger
                          aria-label={`Options for ${group.name}`}
                          disabled={areGroupActionsDisabled}
                          render={<Button size="icon-xs" variant="ghost" />}
                        >
                          <Icon aria-hidden icon={MoreHorizontalIcon} />
                        </DropdownMenuTrigger>
                      </IconButtonTooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            openCreator("label", group.id);
                          }}
                        >
                          <Icon aria-hidden icon={Add01Icon} />
                          New label in group
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditor({
                              id: group.id,
                              kind: "group",
                              mode: "rename",
                            });
                          }}
                        >
                          <Icon aria-hidden icon={PencilEdit02Icon} />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={previousGroup === undefined}
                          onSelect={() => {
                            if (previousGroup !== undefined) {
                              void moveGroup(group.id, {
                                edge: "before",
                                id: previousGroup.id,
                              });
                            }
                          }}
                        >
                          <Icon aria-hidden icon={ArrowUp02Icon} />
                          Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={nextGroup === undefined}
                          onSelect={() => {
                            if (nextGroup !== undefined) {
                              void moveGroup(group.id, {
                                edge: "after",
                                id: nextGroup.id,
                              });
                            }
                          }}
                        >
                          <Icon aria-hidden icon={ArrowDown02Icon} />
                          Move down
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            setDeletingGroup(group);
                          }}
                          tone="destructive"
                        >
                          <Icon aria-hidden icon={Delete01Icon} />
                          Delete group
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </LabelDropTarget>
              </div>
              {renderPresence(
                `delete:${group.id}`,
                deletingGroup?.id === group.id,
                renderDelete({
                  kind: "group",
                  name: group.name,
                  onCancel: () => {
                    setDeletingGroup(null);
                  },
                  onDelete: () => void deleteGroup(group),
                  pending: organizationMutation.isPending,
                })
              )}
              {renderPresence(
                `children:${group.id}`,
                showChildren,
                <>
                  {renderCreator(group.id, children.length > 0)}
                  <ul>{children.map(renderLabelRow)}</ul>
                </>
              )}
            </>
          );
        }}
      </LabelGroupDragRow>
    );
  };

  const groupRows = groups.map(renderGroup).filter((row) => row !== null);
  let listStatus: string | null = null;
  if (areLabelsPending) {
    listStatus = areLabelsPaused
      ? "Waiting for a connection…"
      : "Loading labels…";
  } else if (labelsUnavailable) {
    listStatus = "Could not load labels.";
  } else if (isOrganizationError && organizationData === undefined) {
    listStatus = "Could not load groups.";
  } else if (
    ungrouped.length === 0 &&
    groupRows.length === 0 &&
    editor?.mode !== "create"
  ) {
    listStatus = query === "" ? "No labels yet." : "No labels match.";
  }
  return (
    <LazyMotion features={domMax}>
      <div className="@container flex h-full min-h-0 w-full flex-col">
        <WorkspaceHeader>
          <MailSubviewHeader
            closeAction={{ label: "Close labels", onClick: onClose }}
            onOpenSidebar={onOpenSidebar}
            title="Labels"
            titleClassName="ms-1"
            titleSize="body"
          >
            <Button
              chrome="toolbar"
              disabled={
                areGroupActionsDisabled || !isNonemptyMailboxId(mailboxId)
              }
              onClick={() => {
                openCreator("group");
              }}
              size="sm"
              variant="secondary"
            >
              New group
            </Button>
            <Button
              chrome="toolbar"
              disabled={
                areLabelActionsDisabled || !isNonemptyMailboxId(mailboxId)
              }
              onClick={() => {
                openCreator("label");
              }}
              size="sm"
            >
              New label
            </Button>
          </MailSubviewHeader>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <InputGroup chrome="toolbar" className="min-w-32 flex-1">
              <InputAddon
                aria-hidden
                className="ms-3 flex shrink-0 items-center"
              >
                <Icon icon={Search01Icon} size={14} tone="muted" />
              </InputAddon>
              <Input
                aria-label="Filter labels and groups"
                chrome="attached"
                onChange={(event) => {
                  setLabelSearch(event.currentTarget.value);
                }}
                placeholder="Filter by name"
                value={labelSearch}
              />
            </InputGroup>
            {isNonemptyMailboxId(mailboxId) ? (
              <AutoLabelSwitch
                canManage={canManage}
                className="shrink-0 text-caption text-muted-fg"
                key={mailboxId}
                mailboxId={mailboxId}
              />
            ) : null}
          </div>
        </WorkspaceHeader>
        <m.div
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
          data-labels-list=""
          layoutScroll
        >
          <div
            className={cn(
              rowClassName,
              "mb-1 min-h-8 text-caption text-muted-fg"
            )}
          >
            <span aria-hidden="true" className={gutterCellClassName} />
            <span className={nameCellClassName}>
              <span aria-hidden="true" className={caretCellClassName} />
              Name
            </span>
            <span className="hidden min-w-0 flex-1 truncate ps-2.25 @sm:block">
              Auto-label prompt
            </span>
            <span className={switchCellClassName}>Auto-label</span>
            <span aria-hidden="true" className={menuCellClassName} />
          </div>
          <LabelDragProvider onMove={moveLabel} onMoveGroup={moveGroup}>
            {renderCreator(null, true)}
            {areLabelsPending || labelsUnavailable ? null : (
              <>
                <ul>{groupRows}</ul>
                {!dragDisabled &&
                groups.length > 0 &&
                ungrouped.length === 0 ? (
                  <LabelDropTarget
                    className={rowClassName}
                    disabled={dragDisabled}
                    groupId={null}
                  >
                    <span aria-hidden="true" className={gutterCellClassName} />
                    <Text as="span" size="caption" tone="muted">
                      Drop here to remove from group
                    </Text>
                  </LabelDropTarget>
                ) : null}
                <ul>{ungrouped.map(renderLabelRow)}</ul>
              </>
            )}
            {listStatus === null ? null : (
              <div className="flex flex-wrap items-center gap-3 py-2 ps-8">
                <Text as="p" size="caption" tone="muted">
                  {listStatus}
                </Text>
                {labelsUnavailable && (
                  <Button
                    onClick={() => {
                      void refetchLabels();
                    }}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Try again
                  </Button>
                )}
              </div>
            )}
          </LabelDragProvider>
        </m.div>
      </div>
    </LazyMotion>
  );
};
