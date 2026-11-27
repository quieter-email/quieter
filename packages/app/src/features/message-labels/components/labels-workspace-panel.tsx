"use client";

import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Delete01Icon,
  Edit01Icon,
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
  orderMailboxLabels,
} from "@quieter/mail/mailbox-organization";
import type {
  LabelOrganizationAction,
  MailboxLabel,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
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
import { EyeIcon, EyeOffIcon } from "@quieter/ui/icons";
import { Input } from "@quieter/ui/input";
import { Switch, SwitchThumb } from "@quieter/ui/switch";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from "motion/react";
import { Fragment, useEffect, useReducer, useState } from "react";

import { createLabelGroupTree } from "../domain/label-group-tree";
import type { LabelGroup } from "../domain/label-group-tree";
import { useDeleteMailboxLabel } from "./delete-mailbox-label-dialog";
import { LabelDragProvider, LabelDragRow, LabelDropTarget } from "./label-drag";
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
  | { mode: "create"; kind: "label" | "group"; groupId: string | null }
  | { mode: "rename"; kind: "label" | "group"; id: string };

type ColorEdit = {
  kind: "label" | "group";
  id: string;
  value: MailboxLabelColor;
};

const labelRowClassName =
  "flex min-h-8 w-full items-center gap-2 px-3 py-0.5 sm:px-4";

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
  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
    <p className="min-w-0 flex-1 text-caption text-muted-fg">
      Delete <strong className="font-medium text-fg">{name}</strong>?{" "}
      {kind === "group"
        ? "Its labels move to Ungrouped."
        : "It will be removed from conversations and automatic rules."}
    </p>
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
  const { data: organizationData, isError: isOrganizationError } = useQuery(
    labelOrganizationQueryOptions(
      mailboxId ?? "",
      isNonemptyMailboxId(mailboxId)
    )
  );
  const organization = organizationData ?? emptyLabelOrganization;

  const userLabels = orderMailboxLabels(
    getUserLabels(labelUpdates.project(labels ?? [], labelUpdateState)),
    organization.labelOrder
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
  const updateLabelDetailsMutation = useMutation(
    orpc.mail.updateLabelDetails.mutationOptions()
  );
  const isSavingLabel =
    labelUpdateState.pending.length > 0 || updateLabelDetailsMutation.isPending;
  const hasInlineAction =
    editor !== null ||
    colorEdit !== null ||
    automationLabelId !== null ||
    deletingLabel !== null ||
    deletingGroup !== null;
  const areLabelActionsDisabled =
    !canManage || isSavingLabel || hasInlineAction;

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
  const groups = organization.groups.toSorted((first, second) =>
    first.name.localeCompare(second.name)
  );
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

  const openCreator = (
    kind: "label" | "group",
    groupId: string | null = null
  ) => {
    setLabelSearch("");
    if (groupId !== null) {
      expandGroup(groupId);
    }
    setEditor({ groupId, kind, mode: "create" });
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
    setEditor(null);
  };

  const saveGroup = async (
    draft: Pick<LabelGroup, "name" | "color">,
    groupId?: string
  ) => {
    const saved = await runOrganizationAction(
      groupId === undefined
        ? { ...draft, kind: "create-group", parentId: null }
        : { ...draft, groupId, kind: "update-group", parentId: null },
      groupId === undefined
        ? "Could not create group."
        : "Could not update group."
    );
    if (saved) {
      setEditor(null);
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
    const editingColor =
      colorEdit?.kind === "label" && colorEdit.id === label.id
        ? colorEdit
        : null;
    const groupId = labelGroupTree.getLabelGroupId(label.id);
    const siblings = labelsByGroupId.get(groupId) ?? [];
    const index = siblings.findIndex(({ id }) => id === label.id);
    const previous = index > 0 ? siblings.at(index - 1) : undefined;
    const next = siblings.at(index + 1);
    const renaming =
      editor?.mode === "rename" &&
      editor.kind === "label" &&
      editor.id === label.id;
    return (
      <Fragment key={label.id}>
        <LabelDragRow
          className={labelRowClassName}
          disabled={areGroupActionsDisabled || labelSearch.trim() !== ""}
          groupId={groupId}
          labelId={label.id}
          name={label.name}
        >
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
            <div className="flex min-w-0 flex-1 @sm:w-1/3 @sm:flex-none">
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
            </div>
          ) : (
            <Button
              aria-label={`Edit name for ${label.name}`}
              className="min-w-0 flex-1 @sm:w-1/3 @sm:flex-none"
              disabled={areLabelActionsDisabled}
              onClick={() => {
                setEditor({ id: label.id, kind: "label", mode: "rename" });
              }}
              size="text"
              variant="inline-edit"
            >
              <span className="truncate">{label.name}</span>
            </Button>
          )}
          {mailboxProvider === "managed" ? (
            <span className="shrink-0 text-micro text-muted-fg tabular-nums">
              {managedLabelCountById.get(label.id) ?? 0}
            </span>
          ) : null}
          <div className="hidden min-w-0 flex-1 items-center gap-1 @sm:flex">
            <Text
              as="span"
              className="min-w-0 flex-1"
              size="sm"
              tone="muted"
              truncate
            >
              {getAutoLabelPrompt(label) || "Add prompt…"}
            </Text>
            <IconButtonTooltip label={`Edit prompt for ${label.name}`}>
              <Button
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
                aria-label={`Options for ${label.name}`}
                render={<Button size="icon-xs" variant="ghost" />}
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
                Move down
              </DropdownMenuItem>
              <DropdownMenuItem
                className="@sm:hidden"
                onSelect={() => {
                  setAutomationLabelId(label.id);
                }}
              >
                Edit auto-label prompt
              </DropdownMenuItem>
              {groups.length > 0 ? (
                <DropdownMenuSubmenu>
                  <DropdownMenuSubmenuTrigger
                    disabled={areGroupActionsDisabled}
                  >
                    Move to group
                  </DropdownMenuSubmenuTrigger>
                  <DropdownMenuSubmenuContent>
                    {[
                      { color: null, id: null, name: "Ungrouped" },
                      ...groups,
                    ].map((option) => (
                      <DropdownMenuCheckboxItem
                        checked={
                          labelGroupTree.getLabelGroupId(label.id) === option.id
                        }
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
                        <span className="min-w-0 truncate">{option.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
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
        </LabelDragRow>
        {deletingLabel?.id === label.id ? (
          <li>
            {renderDelete({
              kind: "label",
              name: label.name,
              onCancel: () => {
                setDeletingLabel(null);
              },
              onDelete: () => {
                deleteLabel.mutate(label.id);
              },
              pending: deleteLabel.isPending,
            })}
          </li>
        ) : null}
        {automationLabel?.id === label.id ? (
          <li className="px-3 pb-2">
            <AutoLabelEditor
              canManage={canManage}
              isPending={updateLabelDetailsMutation.isPending}
              key={`${mailboxId}:${label.id}`}
              label={label}
              onCancel={() => {
                setAutomationLabelId(null);
              }}
              onSave={async (settings) =>
                await saveLabelAutomation(label, settings)
              }
            />
          </li>
        ) : null}
      </Fragment>
    );
  };

  const renderCreator = (groupId: string | null) => (
    <AnimatePresence initial={false}>
      {editor?.mode === "create" && editor.groupId === groupId ? (
        <m.div
          animate="open"
          className="overflow-clip"
          exit="closed"
          initial="closed"
          key={editor.kind}
          transition={{
            duration: reducedMotion === true ? 0 : 0.15,
            ease: [0.23, 1, 0.32, 1],
          }}
          variants={{
            closed: { height: 0, opacity: 0 },
            open: { height: "auto", opacity: 1 },
          }}
        >
          <div className={`${labelRowClassName} bg-section`}>
            <span aria-hidden="true" className="w-6 shrink-0" />
            <LabelsInlineEditor
              initialColor={
                editor.kind === "group" ? defaultGroupColor : "gray"
              }
              initialName=""
              kind={editor.kind}
              mode="create"
              onCancel={() => {
                setEditor(null);
              }}
              onSubmit={async (draft) => {
                if (editor.kind === "group") {
                  await saveGroup(draft);
                } else {
                  await createLabel(draft, groupId);
                }
              }}
            />
          </div>
        </m.div>
      ) : null}
    </AnimatePresence>
  );

  const query = labelSearch.trim().toLocaleLowerCase();
  const matches = (label: MailboxLabel) =>
    label.name.toLocaleLowerCase().includes(query);
  const ungrouped = (labelsByGroupId.get(null) ?? []).filter(matches);
  const dragDisabled = areGroupActionsDisabled || query !== "";

  const renderGroup = (group: LabelGroup) => {
    const children = (labelsByGroupId.get(group.id) ?? []).filter(
      (label) =>
        group.name.toLocaleLowerCase().includes(query) || matches(label)
    );
    if (
      children.length === 0 &&
      !group.name.toLocaleLowerCase().includes(query)
    ) {
      return null;
    }
    const expanded = query !== "" || !collapsedGroupIds.has(group.id);
    const editingColor =
      colorEdit?.kind === "group" && colorEdit.id === group.id
        ? colorEdit
        : null;
    const renaming =
      editor?.mode === "rename" &&
      editor.kind === "group" &&
      editor.id === group.id;
    return (
      <li key={group.id}>
        <LabelDropTarget
          className={labelRowClassName}
          disabled={dragDisabled}
          groupId={group.id}
        >
          <IconButtonTooltip
            label={expanded ? "Collapse group" : "Expand group"}
          >
            <Button
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${group.name}`}
              disabled={query !== "" || hasInlineAction}
              onClick={() => {
                toggleGroup(group.id);
              }}
              size="icon-xs"
              variant="ghost"
            >
              <Icon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} />
            </Button>
          </IconButtonTooltip>
          <MailboxColorPicker
            disabled={areGroupActionsDisabled && editingColor === null}
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
                await saveGroup(draft, group.id);
              }}
            />
          ) : (
            <Button
              aria-label={`Edit name for ${group.name}`}
              className="min-w-0 flex-1"
              disabled={areGroupActionsDisabled}
              onClick={() => {
                setEditor({ id: group.id, kind: "group", mode: "rename" });
              }}
              size="text"
              variant="inline-edit"
            >
              <span className="truncate">{group.name}</span>
            </Button>
          )}
          <DropdownMenu>
            <IconButtonTooltip label={`Options for ${group.name}`}>
              <DropdownMenuTrigger
                aria-label={`Options for ${group.name}`}
                disabled={areGroupActionsDisabled}
                render={<Button size="icon-xs" variant="ghost" />}
              >
                <Icon icon={MoreVerticalIcon} />
              </DropdownMenuTrigger>
            </IconButtonTooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  openCreator("label", group.id);
                }}
              >
                New label here
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setDeletingGroup(group);
                }}
                tone="destructive"
              >
                Delete group
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </LabelDropTarget>
        {deletingGroup?.id === group.id
          ? renderDelete({
              kind: "group",
              name: group.name,
              onCancel: () => {
                setDeletingGroup(null);
              },
              onDelete: () => void deleteGroup(group),
              pending: organizationMutation.isPending,
            })
          : null}
        {expanded ? (
          <div className="ms-6 border-s border-border">
            {renderCreator(group.id)}
            <ul>{children.map(renderLabelRow)}</ul>
          </div>
        ) : null}
      </li>
    );
  };

  const groupRows = groups.map(renderGroup).filter((row) => row !== null);
  let loadingStatus = "Could not load groups.";
  if (areLabelsPending) {
    loadingStatus = "Loading labels…";
  } else if (labelsUnavailable) {
    loadingStatus = "Could not load labels.";
  }
  return (
    <LazyMotion features={domAnimation}>
      <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto">
        <MailSubviewHeader
          className="border-b border-border px-3 py-2 sm:px-4"
          closeAction={{ label: "Close labels", onClick: onClose }}
          onOpenSidebar={onOpenSidebar}
          title="Labels"
          titleSize="sm"
        >
          <Button
            disabled={
              areGroupActionsDisabled || !isNonemptyMailboxId(mailboxId)
            }
            onClick={() => {
              openCreator("group");
            }}
            size="xs"
            variant="secondary"
          >
            New group
          </Button>
          <Button
            disabled={
              areLabelActionsDisabled || !isNonemptyMailboxId(mailboxId)
            }
            onClick={() => {
              openCreator("label");
            }}
            size="xs"
          >
            New label
          </Button>
        </MailSubviewHeader>
        {isNonemptyMailboxId(mailboxId) ? (
          <AutoLabelSwitch
            canManage={canManage}
            key={mailboxId}
            mailboxId={mailboxId}
          />
        ) : null}
        <div className={`${labelRowClassName} border-b border-border`}>
          <Icon aria-hidden icon={Search01Icon} size={14} tone="muted" />
          <Input
            aria-label="Filter labels and groups"
            chrome="ghost"
            className="max-w-56 flex-1"
            onChange={(event) => {
              setLabelSearch(event.currentTarget.value);
            }}
            placeholder="Filter by name"
            readOnly={hasInlineAction}
            size="sm"
            value={labelSearch}
          />
        </div>
        <LabelDragProvider
          onMove={(labelId, groupId, target) =>
            void moveLabel(labelId, groupId, target)
          }
        >
          {renderCreator(null)}
          {areLabelsPending || labelsUnavailable || isOrganizationError ? (
            <p className="px-3 py-2 text-caption text-muted-fg">
              {loadingStatus}
            </p>
          ) : null}
          {!areLabelsPending && !labelsUnavailable ? (
            <>
              <ul>{groupRows}</ul>
              {groups.length > 0 && query === "" ? (
                <LabelDropTarget
                  className="flex min-h-7 items-center px-3 text-caption text-muted-fg sm:px-4"
                  disabled={dragDisabled}
                  groupId={null}
                >
                  Ungrouped
                </LabelDropTarget>
              ) : null}
              <ul>{ungrouped.map(renderLabelRow)}</ul>
              {ungrouped.length === 0 &&
              groups.length === 0 &&
              editor === null ? (
                <p className="px-3 py-2 text-caption text-muted-fg">
                  {query === "" ? "No labels yet." : "No labels match."}
                </p>
              ) : null}
            </>
          ) : null}
        </LabelDragProvider>
      </div>
    </LazyMotion>
  );
};
