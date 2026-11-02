"use client";

import {
  Add01Icon,
  Delete01Icon,
  Edit01Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
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
import type {
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
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
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
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useCallback, useEffect, useId, useReducer, useState } from "react";

import { getLabelUpdates } from "./label-update-mutation";

type LabelsWorkspacePanelProps = {
  canManage: boolean;
  mailboxId: string | null;
  mailboxProvider: "gmail" | "managed";
};

type LabelEdit = {
  labelId: MailboxLabel["id"];
} & (
  | { kind: "name"; value: MailboxLabel["name"] }
  | { kind: "color"; value: MailboxLabelColor }
);

const isNonemptyMailboxId = (
  mailboxId: string | null | undefined
): mailboxId is string => (mailboxId?.trim() ?? "") !== "";

export const LabelsWorkspacePanel = ({
  canManage,
  mailboxId,
  mailboxProvider,
}: LabelsWorkspacePanelProps) => {
  const queryClient = useQueryClient();
  const id = useId();
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [newLabelColor, setNewLabelColor] = useState<MailboxLabelColor>("gray");
  const [newLabelName, setNewLabelName] = useState("");
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

    try {
      let labelId: string;
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
  } else if (userLabels.length === 0) {
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
    labelsContent = (
      <ul>
        {userLabels.map((label) => {
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
        })}
      </ul>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Text as="h1" className="min-w-0" size="lg" truncate weight="medium">
            Labels
          </Text>
          <Button
            aria-haspopup="dialog"
            disabled={
              areLabelActionsDisabled || !isNonemptyMailboxId(mailboxId)
            }
            onClick={() => {
              setNewLabelName("");
              setNewLabelColor("gray");
              setIsCreatingLabel(true);
            }}
            size="sm"
            type="button"
          >
            <Icon aria-hidden icon={Add01Icon} />
            New label
          </Button>
        </div>

        <SettingsCard>
          <SettingsInsetRows>
            {isNonemptyMailboxId(mailboxId) ? (
              <AutoLabelSwitch
                canManage={canManage}
                key={mailboxId}
                mailboxId={mailboxId}
              />
            ) : null}
            {labelsContent}
          </SettingsInsetRows>
        </SettingsCard>
      </div>

      <Dialog open={isCreatingLabel} onOpenChange={setIsCreatingLabel}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!createLabelMutation.isPending) {
                void createLabel();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>New label</DialogTitle>
            </DialogHeader>
            <DialogBody spacing="5">
              <div className="space-y-2">
                <label
                  className="text-caption font-medium"
                  htmlFor={`${id}-new-name`}
                >
                  Name
                </label>
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
              </div>
              <div className="space-y-3">
                <p className="text-caption font-medium">Color</p>
                <MailboxColorPicker
                  disabled={!canManage || createLabelMutation.isPending}
                  label="Label color"
                  onChange={setNewLabelColor}
                  value={newLabelColor}
                />
              </div>
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
                  !newLabelName.trim()
                }
                pending={createLabelMutation.isPending}
                pendingLabel="Creating…"
                type="submit"
              >
                Create label
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
