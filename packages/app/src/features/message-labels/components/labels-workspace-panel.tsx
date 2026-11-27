"use client";

import {
  Add01Icon,
  Delete01Icon,
  Edit01Icon,
  FolderAddIcon,
  MoreVerticalIcon,
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
  emptyLabelOrganization,
  mailboxLabelNamedColorSchema,
} from "@quieter/mail/mailbox-organization";
import type {
  LabelOrganizationAction,
  MailboxLabel,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
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
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
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
import { Field, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { EyeIcon, EyeOffIcon } from "@quieter/ui/icons";
import { Input } from "@quieter/ui/input";
import {
  SettingsCard,
  SettingsInsetRows,
  settingsSurfaceVariants,
} from "@quieter/ui/settings-layout";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Text } from "@quieter/ui/text";
import { TextField, TextFieldInput } from "@quieter/ui/text-field";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useId, useReducer, useState } from "react";
import type { ReactNode } from "react";

import { createLabelGroupTree } from "../domain/label-group-tree";
import type { LabelGroup } from "../domain/label-group-tree";
import { LabelGroupDialog } from "./label-group-dialog";
import { LabelGroupRow } from "./label-group-row";
import { LabelGroupSelect } from "./label-group-select";
import type { LabelGroupOption } from "./label-group-select";
import { getLabelUpdates } from "./label-update-mutation";

type LabelsWorkspacePanelProps = {
  canManage: boolean;
  mailboxId: string | null;
  mailboxProvider: "gmail" | "managed";
  onClose: () => void;
  onOpenSidebar: () => void;
};

type LabelEdit = {
  labelId: MailboxLabel["id"];
} & (
  | { kind: "name"; value: MailboxLabel["name"] }
  | { kind: "color"; value: MailboxLabelColor }
);

type GroupDialogState =
  | { group: LabelGroup; kind: "edit" }
  | { kind: "create"; parentId: string | null };

const isNonemptyMailboxId = (
  mailboxId: string | null | undefined
): mailboxId is string => (mailboxId?.trim() ?? "") !== "";

export const LabelsWorkspacePanel = ({
  canManage,
  mailboxId,
  mailboxProvider,
  onClose,
  onOpenSidebar,
}: LabelsWorkspacePanelProps) => {
  const queryClient = useQueryClient();
  const id = useId();
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [newLabelColor, setNewLabelColor] = useState<MailboxLabelColor>("gray");
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelGroupId, setNewLabelGroupId] = useState<string | null>(null);
  const [labelSearch, setLabelSearch] = useState("");
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [groupDialog, setGroupDialog] = useState<GroupDialogState | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<LabelGroup | null>(null);
  const [labelEdit, setLabelEdit] = useState<LabelEdit | null>(null);
  const focusNameInput = useCallback((input: HTMLInputElement | null) => {
    input?.focus();
    input?.select();
  }, []);
  const [deletingLabel, setDeletingLabel] = useState<MailboxLabel | null>(null);
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
    isPending: areLabelsPending,
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
  const userLabels = getUserLabels(
    labelUpdates.project(labels ?? [], labelUpdateState)
  );
  const automationLabel = userLabels.find(
    (label) => label.id === automationLabelId
  );
  const hiddenLabelIds =
    hiddenLabelState.mailboxId === mailboxId
      ? hiddenLabelState.value
      : readHiddenLabelIds(mailboxId);
  const effectiveHiddenLabelIds = computeEffectiveHiddenLabelIds(
    mailboxProvider,
    userLabels,
    hiddenLabelIds
  );
  const visibleLabelCount = userLabels.filter(
    (label) => !effectiveHiddenLabelIds.has(label.id)
  ).length;

  const createLabelMutation = useMutation(
    orpc.mail.createLabel.mutationOptions()
  );
  const updateLabelMutation = useMutation(labelUpdates.options);
  const deleteLabelMutation = useMutation(
    orpc.mail.deleteLabel.mutationOptions()
  );
  const updateLabelDetailsMutation = useMutation(
    orpc.mail.updateLabelDetails.mutationOptions()
  );
  const isSavingLabel =
    labelUpdateState.pending.length > 0 || updateLabelDetailsMutation.isPending;
  const areLabelActionsDisabled =
    !canManage || isSavingLabel || labelEdit !== null;

  const { data: organizationData, isError: isOrganizationError } = useQuery(
    labelOrganizationQueryOptions(
      mailboxId ?? "",
      isNonemptyMailboxId(mailboxId)
    )
  );
  const organization = organizationData ?? emptyLabelOrganization;
  const defaultGroupColor =
    mailboxLabelNamedColorSchema.options.find(
      (color) =>
        color !== "gray" &&
        !organization.groups.some((group) => group.color === color)
    ) ?? "blue";
  const organizationMutation = useMutation({
    mutationFn: async (input: {
      action: LabelOrganizationAction;
      mailboxId: string;
    }) => await updateLabelOrganization(input.mailboxId, input.action),
    onError: async (_error, input) => {
      await queryClient.invalidateQueries({
        queryKey: labelOrganizationQueryOptions(input.mailboxId).queryKey,
      });
    },
    onSuccess: (updated, input) => {
      queryClient.setQueryData(
        labelOrganizationQueryOptions(input.mailboxId).queryKey,
        updated
      );
    },
  });
  const areGroupActionsDisabled =
    areLabelActionsDisabled ||
    organizationData === undefined ||
    organizationMutation.isPending;

  const labelGroupTree = createLabelGroupTree(organization);
  const childGroupsByParentId = new Map<string | null, LabelGroup[]>();
  for (const group of organization.groups.toSorted((first, second) =>
    first.name.localeCompare(second.name)
  )) {
    const parentId =
      group.parentId !== null &&
      labelGroupTree.getGroup(group.parentId) !== undefined
        ? group.parentId
        : null;
    childGroupsByParentId.set(parentId, [
      ...(childGroupsByParentId.get(parentId) ?? []),
      group,
    ]);
  }
  const labelsByGroupId = new Map<string | null, MailboxLabel[]>();
  for (const label of userLabels) {
    const groupId = labelGroupTree.getLabelGroupId(label.id);
    labelsByGroupId.set(groupId, [
      ...(labelsByGroupId.get(groupId) ?? []),
      label,
    ]);
  }
  const groupOptions: LabelGroupOption[] = [];
  const addGroupOptions = (parentId: string | null) => {
    for (const group of childGroupsByParentId.get(parentId) ?? []) {
      groupOptions.push({
        id: group.id,
        label: labelGroupTree.getGroupPath(group.id) ?? group.name,
      });
      addGroupOptions(group.id);
    }
  };
  addGroupOptions(null);

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
    if (!isNonemptyMailboxId(mailboxId) || !canManage) {
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

  const openNewLabelDialog = (groupId: string | null) => {
    setNewLabelName("");
    setNewLabelColor("gray");
    setNewLabelGroupId(groupId);
    setIsCreatingLabel(true);
  };

  const createLabel = async () => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    const name = newLabelName.trim();
    if (name === "") {
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
          color: newLabelColor,
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
          color: newLabelColor,
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
      setNewLabelColor("gray");
      setNewLabelName("");
      await invalidateLabels();
      setIsCreatingLabel(false);
    } catch (error) {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not create label.",
      });
      return;
    }
    if (
      newLabelGroupId !== null &&
      labelGroupTree.getGroup(newLabelGroupId) !== undefined &&
      (await runOrganizationAction(
        { groupId: newLabelGroupId, kind: "move-label", labelId },
        "Label created, but it could not be added to the group. Use Move to group to try again."
      ))
    ) {
      expandGroup(newLabelGroupId);
    }
    setNewLabelGroupId(null);
  };

  const submitGroupDialog = async (
    dialog: GroupDialogState,
    draft: Omit<LabelGroup, "id">
  ) => {
    const saved = await runOrganizationAction(
      dialog.kind === "edit"
        ? { ...draft, groupId: dialog.group.id, kind: "update-group" }
        : { ...draft, kind: "create-group" },
      dialog.kind === "edit"
        ? "Could not update group."
        : "Could not create group."
    );
    if (saved) {
      const { parentId } = draft;
      if (parentId !== null) {
        expandGroup(parentId);
      }
      setGroupDialog(null);
    }
  };

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
      setAutomationLabelId(null);
      toast.success("Auto-label updated.");
      return true;
    } catch (error) {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not update auto-labeling. Please try again.",
      });
      return false;
    }
  };

  const saveLabelEdit = (label: MailboxLabel, edit: LabelEdit) => {
    if (!isNonemptyMailboxId(mailboxId) || !canManage) {
      return;
    }
    const name = edit.kind === "name" ? edit.value.trim() : label.name;
    if (name === "") {
      toast.error("Enter a label name.");
      return;
    }
    setLabelEdit((current) => (current === edit ? null : current));
    if (
      edit.kind === "name"
        ? name === label.name
        : edit.value === (label.color ?? "gray")
    ) {
      return;
    }
    updateLabelMutation.mutate({
      change:
        edit.kind === "name"
          ? { kind: "name", name }
          : { color: edit.value, kind: "color" },
      labelId: label.id,
    });
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

  const deleteLabel = async (label: MailboxLabel) => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }

    try {
      if (isSandboxMailboxId(mailboxId)) {
        const current = getDemoLabelAutomation(mailboxId);
        saveDemoLabelAutomation(mailboxId, {
          ...current,
          deletedLabelIds: [...current.deletedLabelIds, label.id],
        });
      } else {
        await deleteLabelMutation.mutateAsync({ labelId: label.id, mailboxId });
      }
      if (labelEdit?.labelId === label.id) {
        setLabelEdit(null);
      }
      setMailboxHiddenLabelIds((current) => {
        current.delete(label.id);
        return current;
      });
      await invalidateLabels();
      setDeletingLabel(null);
    } catch (error) {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not delete label.",
      });
    }
  };

  const moveLabel = async (label: MailboxLabel, groupId: string | null) => {
    if (
      labelGroupTree.getLabelGroupId(label.id) !== groupId &&
      (await runOrganizationAction(
        { groupId, kind: "move-label", labelId: label.id },
        "Could not move label."
      )) &&
      groupId !== null
    ) {
      expandGroup(groupId);
    }
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

  const renderLabelRow = (label: MailboxLabel) => {
    const isShown = !effectiveHiddenLabelIds.has(label.id);
    const nameEdit =
      labelEdit?.kind === "name" && labelEdit.labelId === label.id
        ? labelEdit
        : null;
    const colorEdit =
      labelEdit?.kind === "color" && labelEdit.labelId === label.id
        ? labelEdit
        : null;
    const prompt = getAutoLabelPrompt(label);

    return (
      <li
        className={settingsSurfaceVariants({ variant: "insetRow" })}
        key={label.id}
      >
        <MailboxColorPicker
          className="flex shrink-0"
          disabled={!canManage || (labelEdit !== null && !colorEdit)}
          label={`Edit color for ${label.name}`}
          onChange={(value) => {
            if (colorEdit) {
              setLabelEdit({ ...colorEdit, value });
            }
          }}
          onOpenChange={(open) => {
            if (open && canManage && labelEdit === null) {
              setLabelEdit({
                kind: "color",
                labelId: label.id,
                value: label.color ?? "gray",
              });
            } else if (!open && colorEdit) {
              saveLabelEdit(label, colorEdit);
            }
          }}
          open={colorEdit !== null}
          trigger="swatch"
          value={colorEdit?.value ?? label.color ?? "gray"}
        />
        <div className="min-w-0 flex-1">
          {nameEdit ? (
            <Input
              aria-label={`Name for ${label.name}`}
              chrome="inline"
              disabled={!canManage}
              maxLength={225}
              onBlur={() => {
                saveLabelEdit(label, nameEdit);
              }}
              onChange={(event) => {
                setLabelEdit({
                  ...nameEdit,
                  value: event.currentTarget.value,
                });
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) {
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setLabelEdit(null);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              ref={focusNameInput}
              required
              value={nameEdit.value}
            />
          ) : (
            <Button
              aria-label={`Edit name for ${label.name}`}
              className="w-full"
              disabled={!canManage || labelEdit !== null}
              onClick={() => {
                setLabelEdit({
                  kind: "name",
                  labelId: label.id,
                  value: label.name,
                });
              }}
              variant="inline-edit"
            >
              <span className="truncate">{label.name}</span>
            </Button>
          )}
        </div>
        {mailboxProvider === "managed" ? (
          <span className="shrink-0 text-micro text-muted-fg tabular-nums">
            {managedLabelCountById.get(label.id) ?? 0}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Text
            as="span"
            className="min-w-0 flex-1"
            size="sm"
            tone="muted"
            truncate
          >
            {prompt || "Add prompt…"}
          </Text>
          <IconButtonTooltip label={`Edit prompt for ${label.name}`}>
            <Button
              aria-haspopup="dialog"
              aria-label={`Edit prompt for ${label.name}`}
              disabled={areLabelActionsDisabled}
              onClick={() => {
                setAutomationLabelId(label.id);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <Icon aria-hidden icon={Edit01Icon} />
            </Button>
          </IconButtonTooltip>
        </div>
        <IconButtonTooltip label={`Auto-label ${label.name}`}>
          <Switch
            aria-label={`Auto-label ${label.name}`}
            checked={label.autoLabel?.enabled !== false}
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
            size="sm"
          >
            <SwitchThumb />
          </Switch>
        </IconButtonTooltip>
        <DropdownMenu>
          <IconButtonTooltip label={`Options for ${label.name}`}>
            <DropdownMenuTrigger
              appearance="icon"
              aria-label={`Options for ${label.name}`}
              className="-me-2"
              disabled={areLabelActionsDisabled}
            >
              <Icon aria-hidden icon={MoreVerticalIcon} />
            </DropdownMenuTrigger>
          </IconButtonTooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={areLabelActionsDisabled}
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
            {organization.groups.length > 0 ? (
              <DropdownMenuSubmenu>
                <DropdownMenuSubmenuTrigger disabled={areGroupActionsDisabled}>
                  Move to group
                </DropdownMenuSubmenuTrigger>
                <DropdownMenuSubmenuContent>
                  {[{ id: null, label: "No group" }, ...groupOptions].map(
                    (option) => (
                      <DropdownMenuCheckboxItem
                        checked={
                          labelGroupTree.getLabelGroupId(label.id) === option.id
                        }
                        closeOnSelect
                        disabled={areGroupActionsDisabled}
                        key={option.id ?? "none"}
                        onCheckedChange={() => {
                          void moveLabel(label, option.id);
                        }}
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    )
                  )}
                </DropdownMenuSubmenuContent>
              </DropdownMenuSubmenu>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={areLabelActionsDisabled}
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
      </li>
    );
  };

  const deletingGroupParent =
    deletingGroup?.parentId === null || deletingGroup === null
      ? undefined
      : labelGroupTree.getGroup(deletingGroup.parentId);
  const searchQuery = labelSearch.trim().toLocaleLowerCase();
  const isSearching = searchQuery !== "";

  const renderBranch = (
    parentId: string | null,
    showAll: boolean
  ): ReactNode[] => {
    const nodes: ReactNode[] = [];
    for (const group of childGroupsByParentId.get(parentId) ?? []) {
      const groupMatches =
        showAll || group.name.toLocaleLowerCase().includes(searchQuery);
      const isExpanded = isSearching || !collapsedGroupIds.has(group.id);
      const children = isExpanded ? renderBranch(group.id, groupMatches) : [];
      if (!isSearching || groupMatches || children.length > 0) {
        nodes.push(
          <LabelGroupRow
            actionsDisabled={areGroupActionsDisabled}
            group={group}
            isExpanded={isExpanded}
            isSearching={isSearching}
            key={group.id}
            onCreateGroup={() => {
              setGroupDialog({ kind: "create", parentId: group.id });
            }}
            onCreateLabel={() => {
              openNewLabelDialog(group.id);
            }}
            onDelete={() => {
              setDeletingGroup(group);
            }}
            onEdit={() => {
              setGroupDialog({ group, kind: "edit" });
            }}
            onToggle={() => {
              toggleGroup(group.id);
            }}
          >
            {children}
          </LabelGroupRow>
        );
      }
    }
    for (const label of labelsByGroupId.get(parentId) ?? []) {
      if (showAll || label.name.toLocaleLowerCase().includes(searchQuery)) {
        nodes.push(renderLabelRow(label));
      }
    }
    return nodes;
  };

  let labelsContent: React.ReactNode;
  if (areLabelsPending) {
    labelsContent = (
      <p
        className={cn(
          "text-body text-muted-fg",
          settingsSurfaceVariants({ variant: "padding" })
        )}
      >
        Loading labels…
      </p>
    );
  } else if (labelsUnavailable) {
    labelsContent = (
      <p
        className={cn(
          "text-body text-destructive",
          settingsSurfaceVariants({ variant: "padding" })
        )}
      >
        Could not load labels.
      </p>
    );
  } else if (userLabels.length === 0 && organization.groups.length === 0) {
    labelsContent = (
      <p
        className={cn(
          "text-body text-muted-fg",
          settingsSurfaceVariants({ variant: "padding" })
        )}
      >
        No labels yet.
      </p>
    );
  } else {
    const tree = renderBranch(null, !isSearching);
    labelsContent = (
      <>
        <TextField
          className={cn(
            // oxlint-disable-next-line shadcn/require-static-classes -- Shared surface scale lives in settings-layout.
            settingsSurfaceVariants({ variant: "insetRow" }),
            "relative"
          )}
        >
          <Icon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 @md:left-6"
            icon={Search01Icon}
            tone="muted"
          />
          <TextFieldInput
            aria-label="Filter labels and groups"
            chrome="ghost"
            // oxlint-disable-next-line shadcn/no-restyle -- Search input leaves room for its leading icon.
            className="pl-7"
            onChange={(event) => {
              setLabelSearch(event.currentTarget.value);
            }}
            placeholder="Filter by name"
            value={labelSearch}
          />
        </TextField>
        {isOrganizationError && organizationData === undefined ? (
          <p
            className={cn(
              "text-body-sm text-muted-fg",
              settingsSurfaceVariants({ variant: "padding" })
            )}
          >
            Could not load groups. Labels are shown without them.
          </p>
        ) : null}
        {tree.length > 0 ? (
          <ul>{tree}</ul>
        ) : (
          <p
            className={cn(
              "text-body text-muted-fg",
              settingsSurfaceVariants({ variant: "padding" })
            )}
          >
            No labels or groups match.
          </p>
        )}
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <MailSubviewHeader
          className="mb-4"
          closeAction={{ label: "Close labels", onClick: onClose }}
          onOpenSidebar={onOpenSidebar}
          title="Labels"
        >
          <Button
            aria-haspopup="dialog"
            disabled={
              areGroupActionsDisabled || !isNonemptyMailboxId(mailboxId)
            }
            onClick={() => {
              setGroupDialog({ kind: "create", parentId: null });
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Icon aria-hidden icon={FolderAddIcon} />
            New group
          </Button>
          <Button
            aria-haspopup="dialog"
            disabled={
              areLabelActionsDisabled || !isNonemptyMailboxId(mailboxId)
            }
            onClick={() => {
              openNewLabelDialog(null);
            }}
            size="sm"
            type="button"
          >
            <Icon aria-hidden icon={Add01Icon} />
            New label
          </Button>
        </MailSubviewHeader>

        <SettingsCard>
          {isNonemptyMailboxId(mailboxId) ? (
            <AutoLabelSwitch
              canManage={canManage}
              key={mailboxId}
              mailboxId={mailboxId}
            />
          ) : null}
          <SettingsInsetRows density="compact">
            {labelsContent}
          </SettingsInsetRows>
        </SettingsCard>
      </div>

      <Dialog open={isCreatingLabel} onOpenChange={setIsCreatingLabel}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !createLabelMutation.isPending &&
                !organizationMutation.isPending
              ) {
                void createLabel();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>New label</DialogTitle>
            </DialogHeader>
            <DialogBody spacing="3">
              <Field>
                <FieldLabel htmlFor={`${id}-new-name`}>Name</FieldLabel>
                <Input
                  disabled={!canManage || createLabelMutation.isPending}
                  id={`${id}-new-name`}
                  maxLength={225}
                  onChange={(event) => {
                    setNewLabelName(event.currentTarget.value);
                  }}
                  placeholder="e.g. Work"
                  required
                  value={newLabelName}
                />
              </Field>
              <Field>
                <Text as="p" weight="medium">
                  Color
                </Text>
                <MailboxColorPicker
                  disabled={!canManage || createLabelMutation.isPending}
                  label="Label color"
                  onChange={setNewLabelColor}
                  value={newLabelColor}
                />
              </Field>
              {groupOptions.length > 0 ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-new-group`}>Group</FieldLabel>
                  <LabelGroupSelect
                    disabled={
                      !canManage ||
                      createLabelMutation.isPending ||
                      organizationMutation.isPending
                    }
                    id={`${id}-new-group`}
                    noneLabel="No group"
                    onChange={setNewLabelGroupId}
                    options={groupOptions}
                    value={newLabelGroupId}
                  />
                </Field>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <DialogCloseButton
                disabled={createLabelMutation.isPending}
                variant="secondary"
              >
                Cancel
              </DialogCloseButton>
              <Button
                disabled={
                  !canManage ||
                  createLabelMutation.isPending ||
                  organizationMutation.isPending ||
                  !newLabelName.trim()
                }
                pending={
                  createLabelMutation.isPending ||
                  organizationMutation.isPending
                }
                pendingLabel="Creating…"
                type="submit"
              >
                Create label
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {groupDialog ? (
        <LabelGroupDialog
          canManage={canManage}
          defaultColor={defaultGroupColor}
          group={groupDialog.kind === "edit" ? groupDialog.group : null}
          groupOptions={
            groupDialog.kind === "edit"
              ? groupOptions.filter(
                  ({ id: optionGroupId }) =>
                    !labelGroupTree
                      .getAncestry(optionGroupId)
                      .some((group) => group.id === groupDialog.group.id)
                )
              : groupOptions
          }
          initialParentId={
            groupDialog.kind === "create" ? groupDialog.parentId : null
          }
          isPending={organizationMutation.isPending}
          onCancel={() => {
            setGroupDialog(null);
          }}
          onSubmit={(draft) => {
            void submitGroupDialog(groupDialog, draft);
          }}
        />
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setDeletingGroup(null);
          }
        }}
        open={!!deletingGroup}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingGroupParent
                ? `Labels and groups inside move to "${deletingGroupParent.name}".`
                : "Labels and groups inside move to the top level."}{" "}
              No labels are deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody>
            <p className="text-body text-fg">
              Delete{" "}
              {deletingGroup?.name ? `"${deletingGroup.name}"` : "this group"}?
            </p>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCloseButton variant="secondary">
              Cancel
            </AlertDialogCloseButton>
            <Button
              disabled={organizationMutation.isPending || !deletingGroup}
              onClick={() => {
                if (deletingGroup) {
                  void deleteGroup(deletingGroup);
                }
              }}
              pending={organizationMutation.isPending}
              pendingLabel="Deleting…"
              variant="destructive"
            >
              Delete group
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {automationLabel ? (
        <AutoLabelEditor
          canManage={canManage}
          isPending={updateLabelDetailsMutation.isPending}
          key={`${mailboxId}:${automationLabel.id}:${JSON.stringify(automationLabel.autoLabel)}`}
          label={automationLabel}
          onCancel={() => {
            setAutomationLabelId(null);
          }}
          onSave={async (settings) =>
            await saveLabelAutomation(automationLabel, settings)
          }
        />
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setDeletingLabel(null);
          }
        }}
        open={!!deletingLabel}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete label</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the label from conversations and automatic rules.
              Rules left without usable settings will be disabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody>
            <p className="text-body text-fg">
              Delete{" "}
              {deletingLabel?.name ? `"${deletingLabel.name}"` : "this label"}?
            </p>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCloseButton variant="secondary">
              Cancel
            </AlertDialogCloseButton>
            <Button
              disabled={deleteLabelMutation.isPending || !deletingLabel}
              onClick={() => {
                if (deletingLabel) {
                  void deleteLabel(deletingLabel);
                }
              }}
              variant="destructive"
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
