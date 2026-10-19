"use client";

import {
  Add01Icon,
  Delete01Icon,
  Edit01Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { EyeIcon, EyeOffIcon } from "@quieter/ui/icons";
import { Input } from "@quieter/ui/input";
import { Textarea } from "@quieter/ui/textarea";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useReducer, useState } from "react";

import { AutoLabelEditor } from "#/features/message-labels/components/auto-label-editor";
import { AutoLabelSwitch } from "#/features/message-labels/components/auto-label-switch";
import { MailboxColorPicker } from "#/features/message-labels/components/mailbox-color-picker";
import { mailboxLabelDotClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";
import {
  MAX_VISIBLE_SIDEBAR_LABELS,
  SIDEBAR_LABEL_VISIBILITY_EVENT,
  computeEffectiveHiddenLabelIds,
  createHiddenLabelState,
  readHiddenLabelIds,
  reduceHiddenLabelState,
  writeHiddenLabelIds,
} from "#/features/message-labels/domain/sidebar-label-visibility";
import { getUserLabels } from "#/features/message-search/state/message-list-search-state";
import {
  getDemoLabelAutomation,
  saveDemoLabelAutomation,
} from "#/lib/demo-mail/label-automation";
import { toastError } from "#/lib/error-toast";
import { getLabelsQueryKey, labelsQueryOptions } from "#/lib/mail/labels-query";
import {
  getManagedLabelCountsQueryKey,
  managedLabelCountsQueryOptions,
} from "#/lib/managed-mailbox-organization-query";
import { orpc } from "#/lib/orpc";
import { isSandboxMailboxId } from "#/lib/sandbox-mailbox";

type LabelsWorkspacePanelProps = {
  canManage: boolean;
  mailboxId: string | null;
  mailboxProvider: "gmail" | "managed";
};

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
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState<MailboxLabelColor>("gray");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftName, setDraftName] = useState("");
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

  const userLabels = getUserLabels(labels ?? []);
  const editingLabel = userLabels.find((label) => label.id === editingLabelId);
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
  const updateLabelMutation = useMutation(
    orpc.mail.updateLabel.mutationOptions()
  );
  const deleteLabelMutation = useMutation(
    orpc.mail.deleteLabel.mutationOptions()
  );
  const updateLabelDetailsMutation = useMutation(
    orpc.mail.updateLabelDetails.mutationOptions()
  );
  const isSavingLabel =
    updateLabelMutation.isPending || updateLabelDetailsMutation.isPending;

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

  const startEditing = (label: MailboxLabel) => {
    setAutomationLabelId(null);
    setEditingLabelId(label.id);
    setDraftName(label.name);
    setDraftDescription(label.description ?? "");
    setDraftColor(label.color ?? "gray");
  };

  const cancelEditing = () => {
    setEditingLabelId(null);
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

  const saveLabelEdit = async (label: MailboxLabel) => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    const name = draftName.trim();
    if (name === "") {
      return;
    }

    try {
      if (isSandboxMailboxId(mailboxId)) {
        const current = getDemoLabelAutomation(mailboxId);
        saveDemoLabelAutomation(mailboxId, {
          ...current,
          updatedLabels: {
            ...current.updatedLabels,
            [label.id]: {
              ...label,
              color: draftColor,
              description: draftDescription.trim() || null,
              name,
            },
          },
        });
      } else {
        await updateLabelMutation.mutateAsync({
          color: draftColor,
          labelId: label.id,
          mailboxId,
          name,
        });
        await updateLabelDetailsMutation.mutateAsync({
          description: draftDescription.trim() === "" ? null : draftDescription,
          inclusionCriteria: label.inclusionCriteria ?? null,
          labelId: label.id,
          mailboxId,
        });
      }
      setEditingLabelId(null);
      await invalidateLabels();
    } catch (error) {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not update label.",
      });
    }
  };

  const toggleSidebarVisibility = async (label: MailboxLabel) => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    if (mailboxProvider === "managed") {
      try {
        if (isSandboxMailboxId(mailboxId)) {
          const current = getDemoLabelAutomation(mailboxId);
          saveDemoLabelAutomation(mailboxId, {
            ...current,
            updatedLabels: {
              ...current.updatedLabels,
              [label.id]: {
                ...label,
                visible: effectiveHiddenLabelIds.has(label.id),
              },
            },
          });
        } else {
          await updateLabelMutation.mutateAsync({
            labelId: label.id,
            mailboxId,
            name: label.name,
            visible: effectiveHiddenLabelIds.has(label.id),
          });
        }
        await invalidateLabels();
      } catch (error) {
        toastError(error, {
          boundary: "labels-panel",
          fallback: "Could not update label.",
        });
      }
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
      if (editingLabelId === label.id) {
        setEditingLabelId(null);
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
      <p className="py-3 text-body text-muted-fg">Loading labels…</p>
    );
  } else if (labelsUnavailable) {
    labelsContent = (
      <p className="py-3 text-body text-destructive">Could not load labels.</p>
    );
  } else if (userLabels.length === 0) {
    labelsContent = (
      <p className="py-3 text-body text-muted-fg">No labels yet.</p>
    );
  } else {
    labelsContent = (
      <ul className="divide-y divide-border border-y border-border">
        {userLabels.map((label) => {
          const isShown = !effectiveHiddenLabelIds.has(label.id);
          const description = label.description ?? label.inclusionCriteria;

          return (
            <li className="flex items-center gap-3 py-4" key={label.id}>
              <span
                aria-hidden
                className={cn(
                  "size-3 shrink-0 rounded-full",
                  mailboxLabelDotClassNameByColor[label.color ?? "gray"]
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body text-fg">{label.name}</p>
                {description ? (
                  <p className="mt-0.5 truncate text-caption text-muted-fg">
                    {description}
                  </p>
                ) : null}
              </div>
              {mailboxProvider === "managed" ? (
                <span className="shrink-0 text-micro text-muted-fg tabular-nums">
                  {managedLabelCountById.get(label.id) ?? 0}
                </span>
              ) : null}
              <Button
                aria-haspopup="dialog"
                aria-label={`Auto-label settings for ${label.name}`}
                disabled={!canManage || updateLabelDetailsMutation.isPending}
                onClick={() => {
                  setAutomationLabelId(label.id);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {label.autoLabel?.enabled === false ? "Paused" : "Auto-label"}
              </Button>
              <DropdownMenu>
                <IconButtonTooltip label={`Options for ${label.name}`}>
                  <DropdownMenuTrigger
                    appearance="icon"
                    aria-label={`Options for ${label.name}`}
                  >
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4"
                      icon={MoreVerticalIcon}
                    />
                  </DropdownMenuTrigger>
                </IconButtonTooltip>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!canManage}
                    onSelect={() => {
                      startEditing(label);
                    }}
                  >
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4"
                      icon={Edit01Icon}
                    />
                    Edit label
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!canManage}
                    onSelect={() => {
                      void toggleSidebarVisibility(label);
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
                    disabled={!canManage}
                    onSelect={() => {
                      setDeletingLabel(label);
                    }}
                    tone="destructive"
                  >
                    <HugeiconsIcon
                      aria-hidden
                      className="size-4"
                      icon={Delete01Icon}
                    />
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
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-sans text-title-sm font-normal text-fg">
              Labels
            </h1>
            <p className="mt-1.5 text-body text-muted-fg">
              Create labels and choose how new mail is sorted.
            </p>
          </div>
          <Button
            aria-haspopup="dialog"
            disabled={!canManage || !isNonemptyMailboxId(mailboxId)}
            onClick={() => {
              setNewLabelName("");
              setNewLabelColor("gray");
              setIsCreatingLabel(true);
            }}
            size="sm"
            type="button"
          >
            <HugeiconsIcon aria-hidden icon={Add01Icon} />
            New label
          </Button>
        </div>

        <div className="space-y-6">
          {isNonemptyMailboxId(mailboxId) ? (
            <AutoLabelSwitch
              canManage={canManage}
              key={mailboxId}
              mailboxId={mailboxId}
            />
          ) : null}
          <div>
            <div className="mb-3 flex items-center justify-between gap-3 text-caption text-muted-fg">
              <span>
                {userLabels.length} label
                {userLabels.length === 1 ? "" : "s"}
              </span>
              <span>{visibleLabelCount} shown in sidebar</span>
            </div>
            {labelsContent}
          </div>
        </div>
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
                  label="Label color"
                  onChange={setNewLabelColor}
                  value={newLabelColor}
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <DialogCloseButton disabled={createLabelMutation.isPending}>
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

      <Dialog
        open={!!editingLabel}
        onOpenChange={(open) => {
          if (!open) {
            cancelEditing();
          }
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (editingLabel && !isSavingLabel) {
                void saveLabelEdit(editingLabel);
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit label</DialogTitle>
            </DialogHeader>
            <DialogBody spacing="5">
              <div className="space-y-2">
                <label
                  className="text-caption font-medium"
                  htmlFor={`${id}-name`}
                >
                  Name
                </label>
                <Input
                  disabled={isSavingLabel || !canManage}
                  id={`${id}-name`}
                  maxLength={225}
                  onChange={(event) => {
                    setDraftName(event.currentTarget.value);
                  }}
                  required
                  value={draftName}
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-caption font-medium"
                  htmlFor={`${id}-description`}
                >
                  Description
                </label>
                <Textarea
                  disabled={isSavingLabel || !canManage}
                  id={`${id}-description`}
                  onChange={(event) => {
                    setDraftDescription(event.currentTarget.value);
                  }}
                  placeholder="A short explanation of what belongs here."
                  rows={2}
                  value={draftDescription}
                />
              </div>
              <div className="space-y-3">
                <p className="text-caption font-medium">Color</p>
                <MailboxColorPicker
                  label="Label color"
                  onChange={setDraftColor}
                  value={draftColor}
                />
              </div>
            </DialogBody>
            <DialogFooter>
              <DialogCloseButton disabled={isSavingLabel}>
                Cancel
              </DialogCloseButton>
              <Button
                disabled={!canManage || isSavingLabel || !draftName.trim()}
                pending={isSavingLabel}
                pendingLabel="Saving…"
                type="submit"
              >
                Save changes
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
            <AlertDialogCloseButton>Cancel</AlertDialogCloseButton>
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
